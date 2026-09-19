// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Testnet commission-rights escrow. Right IDs are unique per deployment and never reused.
/// Token is reserved from the contract's existing balance; there is no deposit function.
contract CommissionEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    IERC20 public immutable token;
    uint256 public totalReserved;
    enum Status { None, Reserved, Claimed }
    struct Right {
        address beneficiary;
        uint256 amount;
        uint64 claimableAt;
        Status status;
    }
    mapping(bytes32 => Right) public rights;
    event Registered(bytes32 indexed rightId, address indexed beneficiary, uint256 amount, uint64 claimableAt);
    event Claimed(bytes32 indexed rightId, address indexed beneficiary, uint256 amount, address indexed caller);
    event SurplusWithdrawn(address indexed to, uint256 amount);
    constructor(address token_, address admin, address registrar) {
        require(block.chainid == 43113 || block.chainid == 31337, "testnet only");
        require(token_.code.length > 0 && admin != address(0) && registrar != address(0), "invalid configuration");
        require(block.chainid != 43113 || token_ == 0x5425890298aed601595a70AB815c96711a31Bc65, "Fuji test USDC only");
        token = IERC20(token_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
    }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function surplus() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        uint256 reserved = totalReserved;
        return bal > reserved ? bal - reserved : 0;
    }
    function register(bytes32 rightId, address beneficiary, uint256 amount, uint64 claimableAt)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(rightId != bytes32(0) && rights[rightId].status == Status.None, "invalid or used ID");
        require(beneficiary != address(0) && beneficiary != address(this) && amount > 0, "invalid right");
        uint256 reserved = totalReserved + amount;
        require(token.balanceOf(address(this)) >= reserved, "insufficient funds");
        rights[rightId] = Right(beneficiary, amount, claimableAt, Status.Reserved);
        totalReserved = reserved;
        emit Registered(rightId, beneficiary, amount, claimableAt);
    }
    function claim(bytes32 rightId) external nonReentrant {
        Right storage right = rights[rightId];
        require(right.status == Status.Reserved, "invalid or claimed ID");
        require(block.timestamp >= right.claimableAt, "not claimable yet");
        address beneficiary = right.beneficiary;
        uint256 amount = right.amount;
        right.status = Status.Claimed;
        totalReserved -= amount;
        emit Claimed(rightId, beneficiary, amount, msg.sender);
        token.safeTransfer(beneficiary, amount);
    }
    function withdrawSurplus(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0) && to != address(this) && amount > 0, "invalid withdrawal");
        require(amount <= surplus(), "exceeds surplus");
        emit SurplusWithdrawn(to, amount);
        token.safeTransfer(to, amount);
    }
}
