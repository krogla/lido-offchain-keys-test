import { Contract, utils } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers, network } from "hardhat"
import { expect } from "chai"
import { prepKeysProofs, setupNopRoots } from "./helpers"
import { prepProofs, prepTree } from "../scripts/helplers/noptree"

const CONTRACT_NAME = "NOR"
const ipfsLink = "some_ipfs_link"

describe("NOR merkle tree (keys batch per leaf)", function () {
  let dc: Contract
  let nor: Contract
  let subm: Contract
  let owner: SignerWithAddress
  let ops: SignerWithAddress[] = []

  before(async () => {
    ;[owner, ...ops] = await ethers.getSigners()
  })

  describe("merkle root math", () => {
    before(async () => {
      const NOR = await ethers.getContractFactory(CONTRACT_NAME)
      nor = await NOR.deploy()
      await nor.deployed()
    })

    function testLogic(treeSize = 4, keysPerBatch = 1) {
      it(`check all possible index/count variations, treeSize: ${treeSize}, keysPerBatch: ${keysPerBatch}`, async () => {
        const tree = prepTree(treeSize, keysPerBatch, ipfsLink)
        for (let keysIndex = 0; keysIndex < treeSize * keysPerBatch; keysIndex++) {
          for (let keysCount = 1; keysCount <= treeSize * keysPerBatch - keysIndex; keysCount++) {
            const batchIndex = Math.floor(keysIndex / keysPerBatch)
            // const batchCount = Math.ceil((keysCount + keysIndex) / keysPerBatch) - batchIndex
            const batchCount = Math.floor((keysCount + keysIndex + keysPerBatch - 1) / keysPerBatch) - batchIndex
            const { hashes, proofs } = prepProofs(tree, batchIndex, batchCount)
            const [lastIndex, root] = await nor.calcTreeRoot(batchIndex, treeSize, 0, hashes, proofs)
            // console.log({ keysIndex, keysCount, batchIndex, batchCount,  hashes, proofs, root })
            expect(root).to.equal(tree.root)
          }
        }
      })
    }
    let treeSize = 1
    while (treeSize < 8) {
      treeSize *= 2
      for (let kpb = 1; kpb < 5; ++kpb) {
        testLogic(treeSize, kpb)
      }
    }
  })
  describe("nop logic", () => {
    const nopParams = [
      {
        treeSizes: [8, 16],
        ipfsURIs: ["ipfs_op1_1", "ipfs_op1_2"],
      },
      {
        treeSizes: [16],
        ipfsURIs: ["ipfs_op2_1"],
      },
      {
        treeSizes: [32],
        ipfsURIs: ["ipfs_op3_1"],
      },
      {
        treeSizes: [16, 16, 8],
        ipfsURIs: ["ipfs_op1_1", "ipfs_op1_2", "ipfs_op1_3"],
      },
      {
        treeSizes: [],
        ipfsURIs: [],
      },
      {
        treeSizes: [4],
        ipfsURIs: ["ipfs_op2_1"],
      },
      {
        treeSizes: [16, 16],
        ipfsURIs: ["ipfs_op3_1", "ipfs_op3_2"],
      },
      {
        treeSizes: [8, 16, 32],
        ipfsURIs: ["ipfs_op4_1", "ipfs_op4_2", "ipfs_op4_3"],
      },
      {
        treeSizes: [16, 4, 8],
        ipfsURIs: ["ipfs_op5_1", "ipfs_op5_2", "ipfs_op5_3"],
      },
    ]

    beforeEach(async function () {
      const NOR = await ethers.getContractFactory(CONTRACT_NAME)
      nor = await NOR.deploy()
      await nor.deployed()
    })

    function testNopLogic(keysPerBatch = 1) {
      it(`calc keys and check roots, keysPerBatch: ${keysPerBatch}`, async () => {
        const keysSkip = 3
        const keysToDeposit = 21
        const keysPerBatch = 2
        const { nopsTrees } = await setupNopRoots(ops, nor, nopParams, keysPerBatch)

        // console.log(await nor.estimateGas.calcKeysToUse(10))
        await nor.testOpIncUsed(1, 0, keysSkip)

        let keysPrepared: any[] = []
        let proofsPrepared: any[] = []
        let keysOffset = 0
        let proofsOffset = 0
        // get from contract balanced keys count per nop
        const opsKeys = await nor.calcKeysToUse(keysToDeposit)
        // console.log(opsKeys)
        for (const opKeys of opsKeys) {
          const opId = opKeys.opId.toNumber()
          const keysToUse = opKeys.keysToUse.toNumber()
          // get from contract nop state
          const opData = await nor.opsData(opId)
          let lastRootId = opData.lastRootId.toNumber()

          let keysToProcess = keysToUse
          while (keysToProcess > 0) {
            const tree = nopsTrees[opId][lastRootId]
            // get from contract nop root
            const root = await nor.getOperatorRoot(opId, lastRootId)
            const treeSize = root.treeSize.toNumber()
            const usedKeys = root.usedKeys.toNumber()
            const keysLeft = treeSize * keysPerBatch - usedKeys
            if (keysLeft == 0) {
              //skip nop root if no more keys
              lastRootId++
              continue
            }

            const keysCount: number = keysToProcess > keysLeft ? keysLeft : keysToProcess
            const keysIndex: number = usedKeys

            // prep keys/signs hashes to submit and proofs arrays from nop published keys
            const batchIndex = Math.floor(keysIndex / keysPerBatch)
            const batchCount = Math.floor((keysCount + keysIndex + keysPerBatch - 1) / keysPerBatch) - batchIndex
            // console.log({ keysIndex, keysCount, batchIndex, batchCount, hashes: tree.hashes })
            const { hashes, proofs } = prepProofs(tree, batchIndex, batchCount)
            // console.log({ hashes, proofs })
            // check proofs
            const [, rootHash] = await nor.calcTreeRoot(batchIndex, treeSize, 0, hashes, proofs)
            expect(rootHash).to.equal(tree.root)
            expect(rootHash).to.equal(root.merkleRoot)

            //combine all data
            keysPrepared = keysPrepared.concat(tree.keys.slice(batchIndex * keysPerBatch, (batchIndex + batchCount) * keysPerBatch))
            proofsPrepared = proofsPrepared.concat(proofs)
            //switch to next nop tree
            lastRootId++
            keysToProcess -= keysCount
          }
          // const gas = await nor.estimateGas.checkOpAllRoots([opId, keysToUse], [keysOffset, proofsOffset], keysPrepared, proofsPrepared)
          // console.log(gas)
          const [ofs, usedKeys] = await nor.checkOpAllRoots([opId, keysToUse], [keysOffset, proofsOffset], keysPrepared, proofsPrepared)

          expect(usedKeys).to.equal(keysToUse)
          // update offsets
          keysOffset = ofs.keysOffset.toNumber()
          proofsOffset = ofs.proofsOffset.toNumber()
        }
      })
    }

    for (let kpb = 1; kpb < 5; ++kpb) {
      testNopLogic(kpb)
    }
  })
  describe("real-like deposits", () => {
    // const nopParams = [
    //   {
    //     treeSizes: [4],
    //     ipfsURIs: ["ipfs_op1_1_1"],
    //   },
    // {
    //   treeSizes: [4],
    //   ipfsURIs: ["ipfs_op2_1_1"],
    // },
    // {
    //   treeSizes: [4],
    //   ipfsURIs: ["ipfs_op3_1_1"],
    // },
    // ]
    const nopParams = [
      {
        treeSizes: [128, 128],
        ipfsURIs: ["ipfs_op1_1_1", "ipfs_op1_1_2"],
        keysPreUsed: 1,
      },
      {
        treeSizes: [256],
        ipfsURIs: ["ipfs_op2_1_1"],
        keysPreUsed: 11,
      },
      {
        treeSizes: [64, 32],
        ipfsURIs: ["ipfs_op3_1_1", "ipfs_op3_1_2"],
        keysPreUsed: 30,
      },
      {
        treeSizes: [16, 32, 128],
        ipfsURIs: ["ipfs_op1_1", "ipfs_op1_2", "ipfs_op1_3"],
        keysPreUsed: 10,
      },
      {
        treeSizes: [64],
        ipfsURIs: ["ipfs_op2_1"],
        keysPreUsed: 1,
      },
      {
        treeSizes: [256, 64, 4],
        ipfsURIs: ["ipfs_op3_1", "ipfs_op3_2", "ipfs_op3_3"],
        keysPreUsed: 0,
      },
      {
        treeSizes: [512, 2, 512],
        ipfsURIs: ["ipfs_op4_1", "ipfs_op4_2", "ipfs_op4_3"],
        keysPreUsed: 100,
      },
      {
        treeSizes: [16, 64, 1024],
        ipfsURIs: ["ipfs_op5_1", "ipfs_op5_2", "ipfs_op5_3"],
        keysPreUsed: 200,
      },
    ]

    before(async () => {
      const DepositContract = await ethers.getContractFactory("DepositContract")
      dc = await DepositContract.deploy()
      await dc.deployed()
    })

    beforeEach(async () => {
      const NOR = await ethers.getContractFactory(CONTRACT_NAME)
      nor = await NOR.deploy()
      await nor.deployed()

      const Submitter = await ethers.getContractFactory("Submitter")
      subm = await Submitter.deploy(dc.address, nor.address)
      await subm.deployed()
      await nor.setSubmitter(subm.address)
    })

    function testDeposit(keysPerBatch = 1) {
      it(`Should deposit 500 keys correctly, keysPerBatch: ${keysPerBatch}`, async () => {
        const keysPerBatch = 2
        const keysToDeposit = 500
        // const keysPreUsed = [1, 1, 3]
        const { nopIds, nopsTrees, cost } = await setupNopRoots(ops, nor, nopParams, keysPerBatch)

        // fill preused keys
        for (let i = 0; i < nopParams.length; i++) {
          const opId = nopIds[i]
          await nor.testOpIncUsed(opId, 0, nopParams[i].keysPreUsed)
        }

        // ensure enough balance
        let submitSum = 0
        let i = 0
        while (submitSum < keysToDeposit * 32) {
          await subm.connect(ops[i]).submit({ value: utils.parseEther("100") })
          i = i === ops.length - 1 ? 0 : i + 1
          submitSum += 100
        }

        const { keysPrepared, proofsPrepared, opsKeys, totalUsedKeys } = await prepKeysProofs(nor, nopsTrees, keysToDeposit)
        const depositNonce = await subm.getDepositNonce()
        // const estimatedGas = await nor.estimateGas.depositBufferedEther(depositNonce, keysToDeposit, keysPrepared, proofsPrepared)
        // console.log("estimatedGas", estimatedGas.toNumber())

        // deposit
        const tx = await subm.depositBufferedEther(depositNonce, keysToDeposit, keysPrepared, proofsPrepared, { gasLimit: 30000000 })
        await expect(tx).to.emit(subm, "Deposited").withArgs(opsKeys[0].opId, opsKeys[0].keysToUse)
        const r = await tx.wait()
        console.log("totalUsedKeys:", totalUsedKeys, "gasUsed:", r.gasUsed.toNumber())

        expect(await subm.getDepositNonce()).to.equal(depositNonce.add(1))
        // check state after
        for (const opKeys of opsKeys) {
          const opId = opKeys.opId.toNumber()
          const opData = await nor.opsData(opId)
          const keysToUse = opKeys.keysToUse.toNumber()
          expect(opData.usedKeys).to.equal(keysToUse + nopParams[opId - 1].keysPreUsed)
          const lastRootId = opData.lastRootId.toNumber()
          let usedKeysSum = 0
          //check used keys in roots
          for (let i = 0; i <= lastRootId; i++) {
            const root = await nor.getOperatorRoot(opId, i)
            usedKeysSum += root.usedKeys.toNumber()
          }
          expect(usedKeysSum).to.equal(keysToUse + nopParams[opId - 1].keysPreUsed)
        }
      })
    }

    for (let kpb = 1; kpb < 5; ++kpb) {
      testDeposit(kpb)
    }
  })
})
