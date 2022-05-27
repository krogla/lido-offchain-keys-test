// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.6;

import "solidity-bytes-utils/contracts/BytesLib.sol";
import "./NOR.sol";
import "hardhat/console.sol";

interface IDepositContract {
  /// @notice A processed deposit event.
  event DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index);

  /// @notice Submit a Phase 0 DepositData object.
  /// @param pubkey A BLS12-381 public key.
  /// @param withdrawal_credentials Commitment to a public key for withdrawals.
  /// @param signature A BLS12-381 signature.
  /// @param deposit_data_root The SHA-256 hash of the SSZ-encoded DepositData object.
  /// Used as a protection against malformed input.
  function deposit(
    bytes calldata pubkey,
    bytes calldata withdrawal_credentials,
    bytes calldata signature,
    bytes32 deposit_data_root
  ) external payable;

  /// @notice Query the current deposit root hash.
  /// @return The deposit root hash.
  function get_deposit_root() external view returns (bytes32);

  /// @notice Query the current deposit count.
  /// @return The deposit count encoded as a little endian 64-bit number.
  function get_deposit_count() external view returns (bytes memory);
}

contract Submitter {
  uint256 public constant PUBKEY_LENGTH = 48;
  uint256 public constant SIGNATURE_LENGTH = 96;

  uint256 public constant DEPOSIT_SIZE = 32 ether;
  uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
  bytes32 internal constant WITHDRAWAL_CREDENTIALS = 0x010000000000000000000000b9d7934878b5fb9610b3fe8a5e441e8fad7e293f;

  event Deposited(uint256 opId, uint256 keys);

  struct OperatorRoot {
    uint256 usedKeys;
    uint256 batchesPerTree;
    bytes32 OperatorRoot;
    string ipfsURI;
  }

  struct OperatorData {
    uint256 keysTotal;
    uint256 usedKeys;
    uint256 lastRootId;
    OperatorRoot[] roots;
  }

  struct OperatorKeys {
    uint256 opId;
    uint256 keysToUse;
  }

  struct OperatorOffsets {
    uint256 keysOffset;
    uint256 proofsOffset;
  }

  struct KeySign {
    bytes key;
    bytes sign;
  }

  NOR private _nor;
  IDepositContract private _depositContract;

  uint256 private _depositedKeys;
  uint256 private _depositNonce;

  constructor(address depositContract, address nor) {
    _depositContract = IDepositContract(depositContract);
    _nor = NOR(nor);
  }

  function getDepositNonce() external view returns (uint256) {
    return _depositNonce;
  }

  function submit() public payable {}

  function depositBufferedEther(
    uint256 depositNonce,
    uint256 keysToDeposit, // how may keys to deposit
    NOR.KeySign[] calldata keys, //full batches!
    bytes32[] calldata proofs
  ) external {
    require(depositNonce == _depositNonce++, "Wrong deposit nonce");
    // require(keys.length % _keysPerBatch == 0, "Invalid keys length");
    NOR.OperatorOffsets memory opsOfs;
    uint256 gas = gasleft();
    NOR.OperatorKeys[] memory opsKeys = _nor.calcKeysToUse(keysToDeposit);
    // console.log("calcKeysToUse gas", gas - gasleft());
    uint256 usedKeys;
    uint256 totalUsedKeys;

    for (uint256 i = 0; i < opsKeys.length; ++i) {
      // console.log(">>>>op", opsKeys[i].opId);
      gas = gasleft();
      (uint256 from, uint256 to) = _nor._getFromTo(opsKeys[i], opsOfs);
      // uint256 from = (opsData[opsKeys[i].opId].usedKeys % _keysPerBatch) + opsOfs.keysOffset;
      // uint256 to = from + opsKeys[i].keysToUse;
      // console.log("keys to deposit", to - from);
      // `opsOfs` contains updated offsets in keys and proofs arrays
      (opsOfs, usedKeys) = _nor._useOpKeys(opsKeys[i], opsOfs, keys, proofs);
      totalUsedKeys += usedKeys;
      require(usedKeys == to - from, "OP's usedKeys and keysToUse missmatch");
      // console.log("keys to deposit", usedKeys);
      // console.log("_useOpKeys gas", gas - gasleft());
      // console.log("from, to", from, to);
      gas = gasleft();
      for (uint256 j = from; j < to; ++j) {
        _stake(keys[j].key, keys[j].sign);
      }
      // console.log("_stake gas", gas - gasleft());
      emit Deposited(opsKeys[i].opId, usedKeys);
    }
    require(totalUsedKeys == keysToDeposit, "totalUsedKeys and keysToDeposit missmatch");
  }

  /**
   * @dev Invokes a deposit call to the official Deposit contract
   * @param _pubkey Validator to stake for
   * @param _signature Signature of the deposit call
   */
  function _stake(bytes memory _pubkey, bytes memory _signature) internal {
    bytes32 withdrawalCredentials = WITHDRAWAL_CREDENTIALS;
    require(withdrawalCredentials != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

    uint256 value = DEPOSIT_SIZE;

    // The following computations and Merkle tree-ization will make official Deposit contract happy
    uint256 depositAmount = value / DEPOSIT_AMOUNT_UNIT;
    assert(depositAmount * DEPOSIT_AMOUNT_UNIT == value);
    // properly rounded

    // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
    bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
    bytes32 signatureRoot = sha256(
      abi.encodePacked(sha256(BytesLib.slice(_signature, 0, 64)), sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64))))
    );

    bytes32 depositDataRoot = sha256(
      abi.encodePacked(
        sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
        sha256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
      )
    );

    uint256 targetBalance = address(this).balance - value;

    _depositContract.deposit{value: value}(_pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
    require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
  }

  /**
   * @dev Padding memory array with zeroes up to 64 bytes on the right
   * @param _b Memory array of size 32 .. 64
   */
  function _pad64(bytes memory _b) internal pure returns (bytes memory) {
    assert(_b.length >= 32 && _b.length <= 64);
    if (64 == _b.length) return _b;

    bytes memory zero32 = new bytes(32);
    assembly {
      mstore(add(zero32, 0x20), 0)
    }

    if (32 == _b.length) return BytesLib.concat(_b, zero32);
    else return BytesLib.concat(_b, BytesLib.slice(zero32, 0, 64 - _b.length));
  }

  /**
   * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
   * @param _value Number less than `2**64` for compatibility reasons
   */
  function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
    result = 0;
    uint256 temp_value = _value;
    for (uint256 i = 0; i < 8; ++i) {
      result = (result << 8) | (temp_value & 0xFF);
      temp_value >>= 8;
    }

    assert(0 == temp_value); // fully converted
    result <<= (24 * 8);
  }
}
