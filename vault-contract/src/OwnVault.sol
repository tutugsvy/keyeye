// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Single-asset-per-position vault for Robinhood Chain.
/// @dev asset address(0) means native ETH. The owner has an explicit emergency
///      rescue path that can withdraw ALL ETH or ERC-20 tokens, including funds
///      deposited by users. This is intentional and must be disclosed before use.
contract OwnVault {
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_BPS = 10_000;
    address public immutable usdg;
    address public owner;

    struct Position {
        uint256 principal;
        uint64 depositedAt;
        uint64 lastClaimAt;
        uint64 unlockAt;
    }

    mapping(address => mapping(address => Position)) public positions;
    mapping(address => uint256) public annualBps;

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error UnsupportedAsset();
    error PositionExists();
    error NoPosition();
    error StillLocked(uint256 unlockAt);
    error TransferFailed();
    error InvalidBps();
    error InvalidDuration();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AnnualRateSet(address indexed asset, uint256 annualBps);
    event Deposited(address indexed account, address indexed asset, uint256 amount, uint256 unlockAt);
    event RewardClaimed(address indexed account, address indexed asset, uint256 amount);
    event Withdrawn(address indexed account, address indexed asset, uint256 principal, uint256 reward);
    event OwnerRescue(address indexed asset, address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
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

    function setAnnualBps(address asset, uint256 bps) external onlyOwner {
        if (asset != address(0) && asset != usdg) revert UnsupportedAsset();
        if (bps > MAX_BPS) revert InvalidBps();
        annualBps[asset] = bps;
        emit AnnualRateSet(asset, bps);
    }

    function depositETH(uint64 lockDuration) external payable {
        if (msg.value == 0) revert ZeroAmount();
        _deposit(address(0), msg.value, lockDuration);
    }

    function depositUSDG(uint256 amount, uint64 lockDuration) external {
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(usdg, msg.sender, address(this), amount);
        _deposit(usdg, amount, lockDuration);
    }

    function claimReward(address asset) external returns (uint256 reward) {
        Position storage p = positions[msg.sender][asset];
        if (p.principal == 0) revert NoPosition();
        reward = _reward(p, asset);
        p.lastClaimAt = uint64(block.timestamp);
        if (reward != 0) _pay(asset, msg.sender, reward);
        emit RewardClaimed(msg.sender, asset, reward);
    }

    function withdraw(address asset) external returns (uint256 principal, uint256 reward) {
        Position memory p = positions[msg.sender][asset];
        if (p.principal == 0) revert NoPosition();
        if (block.timestamp < p.unlockAt) revert StillLocked(p.unlockAt);
        delete positions[msg.sender][asset];
        principal = p.principal;
        reward = _reward(p, asset);
        _pay(asset, msg.sender, principal + reward);
        emit Withdrawn(msg.sender, asset, principal, reward);
    }

    function pendingReward(address account, address asset) external view returns (uint256) {
        Position memory p = positions[account][asset];
        return p.principal == 0 ? 0 : _reward(p, asset);
    }

    function ownerWithdrawETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 value = amount == type(uint256).max ? address(this).balance : amount;
        (bool ok,) = to.call{value: value}("");
        if (!ok) revert TransferFailed();
        emit OwnerRescue(address(0), to, value);
    }

    function ownerWithdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 value = amount == type(uint256).max ? IERC20(token).balanceOf(address(this)) : amount;
        _safeTransfer(token, to, value);
        emit OwnerRescue(token, to, value);
    }

    function _deposit(address asset, uint256 amount, uint64 lockDuration) internal {
        if (lockDuration > 365 days) revert InvalidDuration();
        Position storage p = positions[msg.sender][asset];
        if (p.principal != 0) revert PositionExists();
        uint64 unlockAt = uint64(block.timestamp + lockDuration);
        positions[msg.sender][asset] = Position(amount, uint64(block.timestamp), uint64(block.timestamp), unlockAt);
        emit Deposited(msg.sender, asset, amount, unlockAt);
    }

    function _reward(Position memory p, address asset) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - p.lastClaimAt;
        return (p.principal * annualBps[asset] * elapsed) / (MAX_BPS * YEAR);
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
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
