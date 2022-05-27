import * as dotenv from "dotenv"

import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-waffle"
import "@typechain/hardhat"
import "hardhat-gas-reporter"
import "solidity-coverage"
import { HardhatUserConfig, task } from "hardhat/config"

dotenv.config()

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
const solcSettings6 = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
  evmVersion: "istanbul",
}
const solcSettings8 = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
  evmVersion: "istanbul",
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.6.11",
        settings: solcSettings6,
      },
      {
        version: "0.8.13",
        settings: solcSettings8,
      },
    ],
    overrides: {
      "contracts/0.6.11/deposit_contract.sol": {
        version: "0.6.11",
        settings: {
          optimizer: {
            enabled: true,
            runs: 5000000, // https://etherscan.io/address/0x00000000219ab540356cbb839cbe05303d7705fa#code
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
      accounts: {
        accountsBalance: "10000000000000000000000000",
      },
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
}

export default config
