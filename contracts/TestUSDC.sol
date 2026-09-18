// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Local mock asset, NOT Circle USDC. Initial supply belongs to deployer.
contract TestUSDC is ERC20 {
    constructor() ERC20("Demo USD (TEST ONLY)", "tUSD") {
        require(block.chainid == 31337, "testnet only");
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}
