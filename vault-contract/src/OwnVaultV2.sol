// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20V2 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Multi-position vault. Every deposit gets its own positionId and
/// snapshots the owner-configured rate for that asset and lock duration.
/// @dev address(0) represents native ETH. Owner rescue is intentionally
/// available and makes this a custodial/trusted vault.
contract OwnVaultV2 {
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_BPS = 10_000;

    address public immutable usdg;
    address public owner;
    uint256 public nextPositionId = 1;
    uint256 private _entered;

    struct Position {
        address account;
        address asset;
        uint256 principal;
        uint256 annualBpsSnapshot;
        uint64 depositedAt;
        uint64 lastClaimAt;
        uint64 unlockAt;
        bool active;
    }

    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) private _accountPositionIds;
    mapping(address => mapping(uint256 => uint256)) public annualBpsByDuration;

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error UnsupportedAsset();
    error NoPosition();
    error NotPositionOwner();
    error StillLocked(uint256 unlockAt);
    error TransferFailed();
    error InvalidBps();
    error InvalidDuration();
    error Reentrancy();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AnnualRateSet(address indexed asset, uint256 indexed lockDuration, uint256 annualBps);
    event Deposited(uint256 indexed positionId, address indexed account, address indexed asset, uint256 amount, uint256 annualBps, uint256 unlockAt);
    event RewardClaimed(uint256 indexed positionId, address indexed account, address indexed asset, uint256 amount);
    event Withdrawn(uint256 indexed positionId, address indexed account, address indexed asset, uint256 principal, uint256 reward);
    event OwnerRescue(address indexed asset, address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address usdg_) {
        if (usdg_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        usdg = usdg_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAnnualBps(address asset, uint256 lockDuration, uint256 bps) external onlyOwner {
        _checkAsset(asset);
        if (lockDuration > 365 days) revert InvalidDuration();
        if (bps > MAX_BPS) revert InvalidBps();
        annualBpsByDuration[asset][lockDuration] = bps;
        emit AnnualRateSet(asset, lockDuration, bps);
    }

    function depositETH(uint64 lockDuration) external payable returns (uint256 positionId) {
        if (msg.value == 0) revert ZeroAmount();
        positionId = _deposit(address(0), msg.value, lockDuration);
    }

    function depositUSDG(uint256 amount, uint64 lockDuration) external returns (uint256 positionId) {
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(usdg, msg.sender, address(this), amount);
        positionId = _deposit(usdg, amount, lockDuration);
    }

    function claimReward(uint256 positionId) external nonReentrant returns (uint256 reward) {
        Position storage p = positions[positionId];
        _onlyPositionOwner(p);
        reward = _reward(p);
        p.lastClaimAt = uint64(block.timestamp);
        if (reward != 0) _pay(p.asset, msg.sender, reward);
        emit RewardClaimed(positionId, msg.sender, p.asset, reward);
    }

    function withdraw(uint256 positionId) external nonReentrant returns (uint256 principal, uint256 reward) {
        Position storage p = positions[positionId];
        _onlyPositionOwner(p);
        if (block.timestamp < p.unlockAt) revert StillLocked(p.unlockAt);
        principal = p.principal;
        reward = _reward(p);
        p.active = false;
        p.principal = 0;
        _pay(p.asset, msg.sender, principal + reward);
        emit Withdrawn(positionId, msg.sender, p.asset, principal, reward);
    }

    function pendingReward(uint256 positionId) external view returns (uint256) {
        Position memory p = positions[positionId];
        return p.active ? _reward(p) : 0;
    }

    function getPositionIds(address account) external view returns (uint256[] memory) {
        return _accountPositionIds[account];
    }

    function ownerWithdrawETH(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 value = amount == type(uint256).max ? address(this).balance : amount;
        (bool ok,) = to.call{value: value}("");
        if (!ok) revert TransferFailed();
        emit OwnerRescue(address(0), to, value);
    }

    function ownerWithdrawToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 value = amount == type(uint256).max ? IERC20V2(token).balanceOf(address(this)) : amount;
        _safeTransfer(token, to, value);
        emit OwnerRescue(token, to, value);
    }

    function _deposit(address asset, uint256 amount, uint64 lockDuration) internal returns (uint256 positionId) {
        _checkAsset(asset);
        if (lockDuration > 365 days) revert InvalidDuration();
        uint256 rate = annualBpsByDuration[asset][lockDuration];
        positionId = nextPositionId++;
        uint64 nowTs = uint64(block.timestamp);
        uint64 unlockAt = uint64(block.timestamp + lockDuration);
        positions[positionId] = Position(msg.sender, asset, amount, rate, nowTs, nowTs, unlockAt, true);
        _accountPositionIds[msg.sender].push(positionId);
        emit Deposited(positionId, msg.sender, asset, amount, rate, unlockAt);
    }

    function _reward(Position memory p) internal view returns (uint256) {
        if (!p.active || p.principal == 0) return 0;
        uint256 elapsed = block.timestamp - p.lastClaimAt;
        return (p.principal * p.annualBpsSnapshot * elapsed) / (MAX_BPS * YEAR);
    }

    function _checkAsset(address asset) internal view {
        if (asset != address(0) && asset != usdg) revert UnsupportedAsset();
    }

    function _onlyPositionOwner(Position memory p) internal view {
        if (!p.active || p.principal == 0) revert NoPosition();
        if (p.account != msg.sender) revert NotPositionOwner();
    }

    function _pay(address asset, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _safeTransfer(asset, to, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20V2.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20V2.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
