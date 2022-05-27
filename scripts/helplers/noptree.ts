import { utils } from "ethers"
import crypto from "crypto"

export type KeySign = [key: Buffer, sign: Buffer]

export type Tree = {
  hashes: string[]
  root: string
  ipfsLink: string
  treeSize: number
  keysUsed: number
  keys: KeySign[]
}

export type NopParam = {
  treeSizes: number[]
  ipfsURIs: string[]
  keysPreUsed?: number
}

export type NopsTrees = { [opId: number]: Tree[] }

export const get_random_pseudo_key = () => crypto.randomBytes(48) //.toString("hex")
export const get_random_pseudo_sign = () => crypto.randomBytes(96) //.toString("hex")
export const _hashPair = (a: string, b: string) => utils.solidityKeccak256(["bytes32", "bytes32"], [a, b])
export const _hashRoot = (root: string, ipfs: string) => utils.solidityKeccak256(["bytes32", "string"], [root, ipfs])

export function _hashBatch(start: number, end: number, keys: KeySign[]) {
  let keysSignsBytes: Buffer = Buffer.from([])
  for (let i = start; i < end; i++) {
    keysSignsBytes = Buffer.concat([keysSignsBytes, keys[i][0], keys[i][1]])
  }
  return utils.solidityKeccak256(["bytes"], [keysSignsBytes])
}

// export function _hashKey(index: number, keys: KeySign[]) {
//   const keysSignsBytes: Buffer = Buffer.concat([keys[index][0], keys[index][1]])
//   return utils.solidityKeccak256(["bytes"], [keysSignsBytes])
// }

// export function prepKeysSigns(treeSize = 8, keysPerBatch = 1): KeySign[] {
//   return Array.from({ length: treeSize * keysPerBatch }, () => [get_random_pseudo_key(), get_random_pseudo_sign()])
//   // const keys: KeySign[] = []
//   // for (let i = 0; i < treeSize * keysPerBatch; i++) {
//   //   keys.push([get_random_pseudo_key(), get_random_pseudo_sign()])
//   // }
//   // return keys
// }

export function prepTree(treeSize = 8, keysPerBatch = 1, ipfsLink = "ipfs_link"): Tree {
  // fill with mock keys/signs
  const keys: KeySign[] = Array.from({ length: treeSize * keysPerBatch }, () => [get_random_pseudo_key(), get_random_pseudo_sign()])
  const hashes: string[] = []
  for (let i = 0; i < treeSize; i++) {
    // hash of batch
    hashes.push(_hashBatch(i * keysPerBatch, (i + 1) * keysPerBatch, keys))
  }

  // build merkle tree
  let n = hashes.length
  let offset = 0
  while (n > 0) {
    for (let i = 0; i < n - 1; i += 2) {
      hashes.push(_hashPair(hashes[offset + i], hashes[offset + i + 1]))
    }
    offset += n
    n >>= 1
  }

  return {
    hashes,
    // root: _hashRoot(hashes[hashes.length - 1], ipfsLink),
    root: hashes[hashes.length - 1],
    ipfsLink,
    treeSize,
    keysUsed: 0,
    keys,
  }
}

export function prepNopData(nopParams: NopParam[], keysPerBatch = 1) {
  const nopIds = nopParams.map((p, i) => i + 1)
  const nopsTrees: NopsTrees = {}
  for (let i = 0; i < nopParams.length; i++) {
    const { treeSizes, ipfsURIs } = nopParams[i]
    nopsTrees[nopIds[i]] = []
    for (let j = 0; j < treeSizes.length; j++) {
      const batchesPerTree = treeSizes[j]
      const ipfsLink = ipfsURIs[j]
      nopsTrees[nopIds[i]].push(prepTree(batchesPerTree, keysPerBatch, ipfsLink))
    }
  }
  return { nopIds, nopsTrees }
}

// index - index of start leaf (batch hash)
// count - count of leafs (batches) to use
export function prepProofs(tree: Tree, index = 0, count = 1) {
  if (!count) throw new Error("No keys to prepare")
  const proofs: string[] = []
  const hashes: string[] = []

  let idxL = index
  let idxR = index + count - 1
  let len = tree.treeSize
  let ofs = 0
  for (let i = idxL; i <= idxR; i++) {
    // hash of batch
    hashes.push(tree.hashes[i])
  }

  while (len > 1) {
    const posL = ofs + idxL
    const posR = ofs + idxR
    const corrL = idxL & 0x1
    const corrR = idxR & 0x1
    const posLCorr = posL + (corrL ? -1 : 1)
    const posRCorr = posR + (corrR ? 0 : 1)
    if (posLCorr < posL && posL <= posRCorr) {
      proofs.push(tree.hashes[posLCorr])
    }
    if (posRCorr > posR) {
      proofs.push(tree.hashes[posRCorr])
    }
    ofs += len
    len >>= 1
    idxL >>= 1
    idxR >>= 1
  }

  return { hashes, proofs }
}

// export function prepKeysSigns1(treeSize = 8) {
//   const keys: KeySign[] = []
//   for (let i = 0; i < treeSize; i++) {
//     //keys.push([key, sign])
//     keys.push([get_random_pseudo_key(), get_random_pseudo_sign()])
//   }
//   return keys
// }
// export function prepKeysSigns(treeSize = 8, keysPerBatch = 4) {
//   const keys: KeySign[] = []
//   for (let i = 0; i < treeSize * keysPerBatch; i++) {
//     //keys.push([key, sign])
//     keys.push([get_random_pseudo_key(), get_random_pseudo_sign()])
//   }
//   return keys
// }

// export function prepKeysTree(treeSize = 8, ipfsLink = "ipfs_link", keys: KeySign[]): Tree {
//   const hashes: string[] = []
//   for (let i = 0; i < treeSize; i++) {
//     // hash of batch
//     hashes.push(_hashKey(i, keys))
//   }

//   // build merkle tree
//   let n = hashes.length
//   let offset = 0
//   while (n > 0) {
//     for (let i = 0; i < n - 1; i += 2) {
//       hashes.push(_hashPair(hashes[offset + i], hashes[offset + i + 1]))
//     }
//     offset += n
//     n >>= 1
//   }

//   return {
//     hashes,
//     // root: _hashRoot(hashes[hashes.length - 1], ipfsLink),
//     root: hashes[hashes.length - 1],
//     ipfsLink,
//     treeSize,
//     keysUsed: 0,
//     keys,
//   }
// }
