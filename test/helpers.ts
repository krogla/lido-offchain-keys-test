import { BigNumber, Contract, constants } from "ethers"
import { NopParam, NopsTrees, prepNopData, prepProofs } from "../scripts/helplers/noptree"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { TransactionReceipt } from "@ethersproject/abstract-provider"
import { expect } from "chai"
const { Zero } = constants

export async function setupNopRoots(ops: SignerWithAddress[], nor: Contract, nopParams: NopParam[], keysPerBatch = 1) {
  const { nopIds, nopsTrees } = prepNopData(nopParams, keysPerBatch)
  // console.dir(
  //   nopIds.map((i) => ({ [i]: nopsTrees[i].map((t) => ({ h: t.hashes, r: t.root })) })),
  //   { depth: 10 }
  // )
  if (keysPerBatch > 1) {
    await nor.setKeysPerBatch(keysPerBatch)

    expect(await nor.getKeysPerBatch()).to.equal(keysPerBatch)
  }
  let cost: BigNumber = Zero
  // get keys and set roots

  for (let i = 0; i < nopIds.length; i++) {
    const opId = nopIds[i]
    // add nop
    await nor.setNodeOperator(ops[i].address, true)
    for (let j = 0; j < nopsTrees[opId].length; j++) {
      const { root, ipfsLink, treeSize } = nopsTrees[opId][j]
      // console.dir({ opId, nop: nopsTrees[opId][j].hashes }, { depth: 10 })
      // add nop root
      const tx = await nor.connect(ops[i]).addOperatorRoot(root, treeSize, ipfsLink)
      const r: TransactionReceipt = await tx.wait()
      cost = cost.add(r.gasUsed)
    }
    expect(await nor.getOperatorTotalRoots(opId)).to.deep.equal(nopsTrees[opId].length)
  }
  expect(await nor.getActiveNodeOperators()).to.deep.equal(nopIds.map((k) => BigNumber.from(k)))
  return { nopIds, nopsTrees, cost }
}

export async function prepKeysProofs(nor: Contract, nopsTrees: NopsTrees, keysToDeposit: number) {
  let keysPrepared: any[] = []
  let proofsPrepared: string[] = []
  let keysOffset = 0
  let proofsOffset = 0
  // will be =1 in case of single key per leaf
  const keysPerBatch = (await nor.getKeysPerBatch()).toNumber()
  const opsKeys = await nor.calcKeysToUse(keysToDeposit)
  let i = 0
  let totalUsedKeys = 0
  for (const opKeys of opsKeys) {
    const opId = opKeys.opId.toNumber()
    const keysToUse = opKeys.keysToUse.toNumber()
    const opData = await nor.opsData(opId)
    let lastRootId = opData.lastRootId.toNumber()
    // console.log({ opId, keysToUse })
    let keysToProcess = keysToUse
    while (keysToProcess > 0) {
      const tree = nopsTrees[opId][lastRootId]
      // console.log({ tree })
      const root = await nor.getOperatorRoot(opId, lastRootId)
      // console.log({ root })
      const treeSize = root.treeSize.toNumber()
      const usedKeys = root.usedKeys.toNumber()
      const keysLeft = treeSize * keysPerBatch - usedKeys
      if (keysLeft == 0) {
        lastRootId++
        continue
      }

      const keysCount = keysToProcess > keysLeft ? keysLeft : keysToProcess
      const keysIndex = usedKeys
      // nopsTrees[opId][t].keysUsed = keysCount
      const batchIndex = Math.floor(keysIndex / keysPerBatch)
      // const batchCount = Math.floor((keysCount + 1) / keysPerBatch)
      const batchCount = Math.floor((keysCount + keysIndex + keysPerBatch - 1) / keysPerBatch) - batchIndex

      // console.log({ keysIndex, keysCount, batchIndex, batchCount })
      const { hashes, proofs } = prepProofs(tree, batchIndex, batchCount)
      // console.log({hashes, proofs});
      keysPrepared = keysPrepared.concat(tree.keys.slice(batchIndex * keysPerBatch, (batchIndex + batchCount) * keysPerBatch))
      proofsPrepared = proofsPrepared.concat(proofs)
      keysToProcess -= keysCount
      lastRootId++
    }

    // console.log({keysToProcess,keysPrepared, proofsPrepared});

    const [ofs, usedKeys] = await nor.checkOpAllRoots([opId, keysToUse], [keysOffset, proofsOffset], keysPrepared, proofsPrepared)

    keysOffset = ofs.keysOffset.toNumber()
    proofsOffset = ofs.proofsOffset.toNumber()
    totalUsedKeys += usedKeys.toNumber()
    // console.log({ i, keysOffset, proofsOffset, usedKeys: usedKeys.toNumber() })
    i++
  }
  return { keysPrepared: keysPrepared, proofsPrepared: proofsPrepared, opsKeys, totalUsedKeys }
}
