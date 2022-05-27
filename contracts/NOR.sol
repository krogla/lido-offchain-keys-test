// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.6;

import "solidity-bytes-utils/contracts/BytesLib.sol";
import "hardhat/console.sol";

contract NOR {
  struct NO {
    bool exists;
    bool active;
    uint256 id;
  }

  struct OperatorRoot {
    uint256 usedKeys;
    uint256 treeSize;
    bytes32 merkleRoot;
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

  mapping(uint256 => OperatorData) public opsData;

  uint256 private _totalKeys;
  uint256 private _depositedKeys;

  uint256 private _depositNonce;
  address private _submitter;

  mapping(address => NO) public nodeOperators;
  address[] public nodeOperatorIds;
  uint256[] public activeNodeOperatorIds;
  uint256 private _keysPerBatch = 1;

  modifier onlyNodeOperator() {
    require(nodeOperators[msg.sender].active, "AUTH_FAILED");
    _;
  }

  modifier onlySubmitter() {
    require(msg.sender == _submitter, "AUTH_FAILED");
    _;
  }

  function setSubmitter(address submitter) public {
    _submitter = submitter;
  }

  function getNodeOparator(address operator) public view returns (NO memory) {
    return nodeOperators[operator];
  }

  function setNodeOperator(address operator, bool active) public {
    NO storage no = nodeOperators[operator];
    if (!no.exists) {
      nodeOperatorIds.push(operator);
      no.id = nodeOperatorIds.length;
      no.exists = true;
    }
    no.active = active;
    delete activeNodeOperatorIds;
    for (uint256 i = 1; i <= nodeOperatorIds.length; i++) {
      if (nodeOperators[nodeOperatorIds[i - 1]].active) {
        activeNodeOperatorIds.push(i);
      }
    }
  }

  function getActiveNodeOperators() public view returns (uint256[] memory) {
    return activeNodeOperatorIds;
  }

  function setKeysPerBatch(uint256 keysPerBatch) external {
    _keysPerBatch = keysPerBatch;
  }

  function _getKeysPerBatch() internal view returns (uint256) {
    return _keysPerBatch;
  }

  function getKeysPerBatch() external view returns (uint256) {
    return _getKeysPerBatch();
  }

  function getDepositNonce() external view returns (uint256) {
    return _depositNonce;
  }

  function getOperatorTotalRoots(uint256 opId) public view returns (uint256) {
    return opsData[opId].roots.length;
  }

  function getOperatorRoot(uint256 opId, uint256 treeId) public view returns (OperatorRoot memory) {
    return opsData[opId].roots[treeId];
  }

  function testOpIncUsed(
    uint256 opId,
    uint256 treeId,
    uint256 usedKeys
  ) public {
    opsData[opId].roots[treeId].usedKeys += usedKeys;
    opsData[opId].usedKeys += usedKeys;
  }

  function addOperatorRoot(
    bytes32 root,
    uint256 treeSize,
    string memory ipfsURI
  ) external onlyNodeOperator {
    uint256 opId = getNodeOparator(msg.sender).id;
    uint256 keys = treeSize * _getKeysPerBatch();
    opsData[opId].roots.push(OperatorRoot(0, treeSize, root, ipfsURI));
    opsData[opId].keysTotal += keys;
    _totalKeys += keys;
  }

  // helper method to calc right keys ofssets for offchain tools
  function _getFromTo(OperatorKeys memory ok, OperatorOffsets memory opsOfs) public view returns (uint256 from, uint256 to) {
    from = (opsData[ok.opId].usedKeys % _getKeysPerBatch()) + opsOfs.keysOffset;
    to = from + ok.keysToUse;
  }

  function _useOpKeys(
    OperatorKeys memory ok,
    OperatorOffsets memory opsOfs,
    KeySign[] calldata keys, //full batches!
    bytes32[] calldata proofs
  ) public onlySubmitter returns (OperatorOffsets memory, uint256 usedKeys) {
    require(ok.keysToUse > 0, "No keys to process");
    uint256 rootId = opsData[ok.opId].lastRootId;
    uint256 keysToProcess;
    uint256 freeKeys;
    while (ok.keysToUse > 0) {
      require(rootId < opsData[ok.opId].roots.length, "No more free keys");
      OperatorRoot memory root = opsData[ok.opId].roots[rootId];
      (keysToProcess, freeKeys, opsOfs) = checkOpRoot(root, ok.keysToUse, opsOfs, keys, proofs);
      if (keysToProcess > 0) {
        ok.keysToUse -= keysToProcess;
        usedKeys += keysToProcess;
        // update root used keys
        opsData[ok.opId].roots[rootId].usedKeys += keysToProcess;
      }
      if (freeKeys == 0) {
        rootId++;
      }
    }
    // update op total used keys
    opsData[ok.opId].usedKeys += usedKeys;
    // update total used keys
    _depositedKeys += usedKeys;
    // correct rootId in case it was last and fulfilled for OP
    if (rootId == opsData[ok.opId].roots.length) {
      rootId--;
    }
    opsData[ok.opId].lastRootId = rootId;
    return (opsOfs, usedKeys);
  }

  function checkOpAllRoots(
    OperatorKeys memory ok,
    OperatorOffsets memory opsOfs,
    KeySign[] calldata keys, //full batches in batched case
    bytes32[] calldata proofs
  ) public view virtual returns (OperatorOffsets memory, uint256 usedKeys) {
    require(ok.keysToUse > 0, "No keys to process");
    uint256 rootId = opsData[ok.opId].lastRootId;
    while (ok.keysToUse > 0) {
      require(rootId < opsData[ok.opId].roots.length, "No more free keys");
      uint256 keysToProcess;
      uint256 freeKeys;
      (keysToProcess, freeKeys, opsOfs) = checkOpRoot(opsData[ok.opId].roots[rootId], ok.keysToUse, opsOfs, keys, proofs);
      if (keysToProcess > 0) {
        ok.keysToUse -= keysToProcess;
        usedKeys += keysToProcess;
      }
      if (freeKeys == 0) {
        rootId++;
      }
    }
    return (opsOfs, usedKeys);
  }

  function checkOpRoot1(
    OperatorRoot memory root,
    uint256 keysToUse,
    OperatorOffsets memory opsOfs,
    KeySign[] calldata keys,
    bytes32[] calldata proofs
  )
    internal
    view
    virtual
    returns (
      uint256 keysToProcess,
      uint256 freeKeys,
      OperatorOffsets memory
    )
  {
    freeKeys = root.treeSize - root.usedKeys;
    keysToProcess = freeKeys < keysToUse ? freeKeys : keysToUse;
    if (keysToProcess > 0) {
      bytes32 calcedRoot;
      bytes32[] memory hashes;
      (opsOfs.keysOffset, hashes) = prepKeysHashes(keysToProcess, opsOfs.keysOffset, keys);
      (opsOfs.proofsOffset, calcedRoot) = calcTreeRoot(root.usedKeys, root.treeSize, opsOfs.proofsOffset, hashes, proofs);
      require(root.merkleRoot == calcedRoot, "Wrong root!");
    }
    return (keysToProcess, freeKeys - keysToProcess, opsOfs);
  }

  function checkOpRoot(
    OperatorRoot memory root,
    uint256 keysToUse,
    OperatorOffsets memory opsOfs,
    KeySign[] calldata keys,
    bytes32[] calldata proofs
  )
    internal
    view
    returns (
      uint256 keysToProcess,
      uint256 freeKeys,
      OperatorOffsets memory
    )
  {
    uint256 keysPerBatch = _getKeysPerBatch();
    freeKeys = root.treeSize * keysPerBatch - root.usedKeys;
    keysToProcess = freeKeys < keysToUse ? freeKeys : keysToUse;
    if (keysToProcess > 0) {
      bytes32 calcedRoot;
      bytes32[] memory hashes;
      if (keysPerBatch == 1) {
        // single key per leaf
        (opsOfs.keysOffset, hashes) = prepKeysHashes(keysToProcess, opsOfs.keysOffset, keys);
        (opsOfs.proofsOffset, calcedRoot) = calcTreeRoot(root.usedKeys, root.treeSize, opsOfs.proofsOffset, hashes, proofs);
      } else {
        uint256 batchIndex;
        (opsOfs.keysOffset, batchIndex, hashes) = prepBatchHashes(root, keysToProcess, keysPerBatch, opsOfs.keysOffset, keys);
        (opsOfs.proofsOffset, calcedRoot) = calcTreeRoot(batchIndex, root.treeSize, opsOfs.proofsOffset, hashes, proofs);
      }
      require(root.merkleRoot == calcedRoot, "Wrong root!");
    }
    return (keysToProcess, freeKeys - keysToProcess, opsOfs);
  }

  function calcTreeRoot(
    uint256 idxLeft,
    uint256 treeSize,
    uint256 proofsOffset,
    bytes32[] memory leafs,
    bytes32[] calldata proofs
  ) public pure returns (uint256 idxRight, bytes32) {
    idxRight = idxLeft + leafs.length - 1;

    while (treeSize > 1) {
      uint256 n = 0;
      if (idxLeft % 2 != 0 && idxLeft <= idxRight + 1 - (idxRight % 2)) {
        leafs[0] = calcPairHash(proofs[proofsOffset++], leafs[0]);
        n++;
      }
      if (idxRight > idxLeft) {
        uint256 k = n;
        while (k < idxRight - idxLeft) {
          leafs[n] = calcPairHash(leafs[k], leafs[k + 1]);
          k += 2;
          n++;
        }
      }
      if (idxRight % 2 == 0) {
        leafs[n] = calcPairHash(leafs[idxRight - idxLeft], proofs[proofsOffset++]);
      }
      treeSize >>= 1;
      idxLeft >>= 1;
      idxRight >>= 1;
    }
    return (proofsOffset, leafs[0]);
  }

  /***
   * @dev Split keys array to batches and calculatest hashes
   * @param root Operator's current tree root.
   * @param count Keys to hash count
   * @param offset Offset in keys array.
   * @param data Arbitrary data structure, intended to contain user-defined parameters.
   *
   * @return offset - offset of next tree in keys array
   * @return index - index of 1st batch hash
   * @return hashes - array of batches hashes
   */
  function prepKeysHashes(
    uint256 count,
    uint256 offset,
    KeySign[] calldata keys
  ) internal pure returns (uint256, bytes32[] memory hashes) {
    hashes = new bytes32[](count);
    for (uint256 i = 0; i < count; i++) {
      hashes[i] = keccak256(BytesLib.concat(keys[offset].key, keys[offset].sign));
      offset++;
    }
    return (offset, hashes);
  }

  function calcPairHash(bytes32 a, bytes32 b) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(a, b));
  }

  /***
   * @dev Split keys array to batches and calculatest hashes
   * @param root Operator's current tree root.
   * @param count Keys to hash count
   * @param keysPerBatch Keys per batch.
   * @param offset Offset in keys array.
   * @param data Arbitrary data structure, intended to contain user-defined parameters.
   *
   * @return offset - offset of next tree in keys array
   * @return index - index of 1st batch hash
   * @return hashes - array of batches hashes
   */
  function prepBatchHashes(
    OperatorRoot memory root,
    uint256 count,
    uint256 keysPerBatch,
    uint256 offset,
    KeySign[] calldata keys
  )
    internal
    pure
    returns (
      uint256,
      uint256 index,
      bytes32[] memory hashes
    )
  {
    index = root.usedKeys / keysPerBatch;
    // reusing var; alternative to Math.ceil((count + root.usedKeys) / keysPerBatch) - index
    count = (count + root.usedKeys + keysPerBatch - 1) / keysPerBatch - index;
    hashes = new bytes32[](count);
    for (uint256 i = 0; i < count; i++) {
      hashes[i] = calcBatchHash(offset, offset + keysPerBatch, keys);
      offset += keysPerBatch;
    }
    return (offset, index, hashes);
  }

  function calcBatchHash(
    uint256 start,
    uint256 end,
    KeySign[] calldata keys
  ) public pure returns (bytes32) {
    bytes memory keysSignsBytes;
    for (uint256 i = start; i < end; i++) {
      keysSignsBytes = BytesLib.concat(keysSignsBytes, BytesLib.concat(keys[i].key, keys[i].sign));
    }
    return keccak256(keysSignsBytes);
  }

  function calcKeysToUse(uint256 keysToDeposit) public view returns (OperatorKeys[] memory opsKeys) {
    uint256[] memory opIds = getActiveNodeOperators();
    opsKeys = new OperatorKeys[](opIds.length);

    uint256[] memory keysRest = new uint256[](opIds.length);
    uint256[] memory keysToUse = new uint256[](opIds.length);
    uint256[] memory keysUsed = new uint256[](opIds.length);
    uint256 countToBalance = opIds.length;
    uint256 countBalanced = 0;
    // avg of total keys used by all OPs per 1 op
    uint256 avgKeysPerOp;
    for (uint256 i = 0; i < opIds.length; i++) {
      keysUsed[i] = opsData[opIds[i]].usedKeys;
      keysRest[i] = opsData[opIds[i]].keysTotal - keysUsed[i];
      if (keysRest[i] == 0) {
        countToBalance--;
      }
      avgKeysPerOp += keysUsed[i];
    }

    // try to rebalance keys amount per OP
    avgKeysPerOp = avgKeysPerOp / countToBalance + 1;
    bool run = true;
    do {
      if (keysToDeposit > 0 && countToBalance > 0) {
        avgKeysPerOp += keysToDeposit / countToBalance + 1;
      } else {
        run = false;
      }
      for (uint256 i = 0; i < opIds.length; i++) {
        // OP free keys
        if (run && keysRest[i] > 0 && avgKeysPerOp > keysUsed[i]) {
          uint256 _keysToUse = avgKeysPerOp - keysUsed[i];

          if (_keysToUse > keysToDeposit) {
            _keysToUse = keysToDeposit;
          }
          if (_keysToUse >= keysRest[i]) {
            _keysToUse = keysRest[i];
            // if all op keys are used, exclude it from next rebalance cycle
            countToBalance--;
          }
          if (_keysToUse > 0) {
            keysToUse[i] += _keysToUse;
            keysUsed[i] += _keysToUse;
            keysRest[i] -= _keysToUse;
            keysToDeposit -= _keysToUse;
          }
        }
        if ((!run || keysRest[i] == 0) && keysToUse[i] > 0) {
          opsKeys[countBalanced] = OperatorKeys(opIds[i], keysToUse[i]);
          countBalanced++;
          keysToUse[i] = 0;
        }
      }
    } while (run);
    // requested keys amount must be less than total free keys amount
    // so all keys must be used
    require(keysToDeposit == 0, "No free keys");

    // shrink array
    if (countBalanced < opIds.length) {
      uint256 trim = opIds.length - countBalanced;
      assembly {
        mstore(opsKeys, sub(mload(opsKeys), trim))
      }
    }
  }
}
