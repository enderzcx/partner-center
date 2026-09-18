// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Local EVM fixture only. Never deploy or fund on a public network.
contract X402TestUSDC {
    string public constant name = "USD Coin";
    string public constant version = "2";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function transfer(address to, uint256 value) external returns (bool) { _transfer(msg.sender, to, value); return true; }
    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value; balanceOf[to] += value; emit Transfer(from, to, value);
    }
    function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) external {
        require(block.timestamp > validAfter && block.timestamp < validBefore, "time");
        require(!authorizationState[from][nonce], "used");
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256(bytes(name)),keccak256(bytes(version)),block.chainid,address(this)));
        bytes32 body = keccak256(abi.encode(keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),from,to,value,validAfter,validBefore,nonce));
        require(from != address(0) && ecrecover(keccak256(abi.encodePacked("\x19\x01",domain,body)),v,r,s)==from,"signature");
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from,nonce);
        _transfer(from,to,value);
    }
}
