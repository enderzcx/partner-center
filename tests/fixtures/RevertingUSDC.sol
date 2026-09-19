// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// @notice Local fixture token that can force transfer failure. Never deploy on a public network.
contract RevertingUSDC {
    string public name = "Reverting USD (TEST ONLY)";
    string public symbol = "rUSD";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    bool public revertTransfers;
    event Transfer(address indexed from, address indexed to, uint256 value);
    constructor() {
        require(block.chainid == 31337, "testnet only");
        balanceOf[msg.sender] = 1_000_000 * 10 ** 6;
    }
    function setRevertTransfers(bool v) external { revertTransfers = v; }
    function transfer(address to, uint256 value) external returns (bool) {
        require(!revertTransfers, "forced revert");
        require(to != address(0) && balanceOf[msg.sender] >= value, "invalid transfer");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
}
