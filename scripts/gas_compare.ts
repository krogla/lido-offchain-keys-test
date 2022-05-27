import { ethers, network } from "hardhat"
import { prepKeysProofs, setupNopRoots } from "../test/helpers"
import { utils } from "ethers"
import { writeFileSync } from "fs"

async function main() {
  const DepositContract = await ethers.getContractFactory("DepositContract")
  const dc = await DepositContract.deploy()
  await dc.deployed()

  const NOR = await ethers.getContractFactory("NOR")
  const nor = await NOR.deploy()
  await nor.deployed()

  const Submitter = await ethers.getContractFactory("Submitter")
  const subm = await Submitter.deploy(dc.address, nor.address)
  await subm.deployed()
  await nor.setSubmitter(subm.address)

  const keysToDeposit = 200
  const treeSizes = [2, 4, 8, 16, 32, 64, 1024]
  const keysPerBatches = [1, 2, 3, 4, 8, 16]

  const [owner, ...ops] = await ethers.getSigners()

  const gasDeposit = []
  const gasAddRoot = []
  let line = [0]
  let line2 = [0]
  for (const keysPerBatch of keysPerBatches) {
    line.push(keysPerBatch)
  }
  gasDeposit.push(line)
  gasAddRoot.push(line)

  for (const treeSize of treeSizes) {
    line = [treeSize]
    line2 = [treeSize]
    for (const keysPerBatch of keysPerBatches) {
      await test1(keysToDeposit, treeSize, keysPerBatch)
      gasDeposit.push(line)
      gasAddRoot.push(line2)
    }
  }

  writeCSV(gasDeposit, "treeSize \\ keysPerBatch", "gas_per_1key_deposit.csv")
  writeCSV(gasAddRoot, "treeSize \\ keysPerBatch", "gas_per_1root_add.csv")

  async function test1(keysToDeposit: number, treeSize: number, keysPerBatch: number) {
    const nopCnt = 3
    const treeCnt = Math.ceil(keysToDeposit / keysPerBatch / treeSize / nopCnt)
    const nopParams = [
      {
        treeSizes: new Array(treeCnt).fill(treeSize),
        ipfsURIs: new Array(treeCnt).fill("dummyIpfsHash"),
      },
      {
        treeSizes: new Array(treeCnt).fill(treeSize),
        ipfsURIs: new Array(treeCnt).fill("dummyIpfsHash"),
      },
      {
        treeSizes: new Array(treeCnt).fill(treeSize),
        ipfsURIs: new Array(treeCnt).fill("dummyIpfsHash"),
      },
    ]
    console.log(
      `deposit ${keysToDeposit} keys to ${nopCnt} op with ${treeCnt} trees, ${treeSize} batched per tree and ${keysPerBatch} keysPerBatch`
    )
    const snapshotId = await network.provider.send("evm_snapshot")
    let a = 32 * keysToDeposit
    while (a > 0) {
      for (const acc of ops) {
        await subm.connect(acc).submit({ value: utils.parseEther("32") })
        a -= 32
        if (a <= 0) {
          break
        }
      }
    }
    // console.log({ keysToDeposit, keysPerBatch, treeSize, treeCnt })
    await nor.setKeysPerBatch(keysPerBatch)

    const { nopsTrees, cost } = await setupNopRoots(ops, nor, nopParams, keysPerBatch)
    const { keysPrepared, proofsPrepared, totalUsedKeys } = await prepKeysProofs(nor, nopsTrees, keysToDeposit)
    const depositNonce = await subm.getDepositNonce()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const tx = await subm.depositBufferedEther(depositNonce, keysToDeposit, keysPrepared, proofsPrepared, { gasLimit: 30000000 })
    const r = await tx.wait()
    console.log("Add root gas used:", cost.toNumber(), "Deposit gas used:", r.gasUsed.toNumber())
    line.push(r.gasUsed.toNumber() / keysToDeposit)
    line2.push(cost.toNumber() / treeCnt / nopCnt)
    await network.provider.send("evm_revert", [snapshotId])
  }
}

function writeCSV(data: any[], legend = "", filename = "data.csv") {
  const lineArray: string[] = []
  data.forEach(function (infoArray: any[], index: number) {
    if (index == 0 && lineArray.length == 0) {
      infoArray[0] = legend
    }
    const line = infoArray.join(",")
    // lineArray.push(index == 0 ? "data:text/csv;charset=utf-8," + line : line)
    lineArray.push(line)
  })

  const csvContent = lineArray.join("\n")
  writeFileSync(filename, csvContent)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
