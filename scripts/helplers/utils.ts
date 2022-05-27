import { BigNumber } from "ethers"

export const bn2n: any = (vals: any[]) =>
  vals.map((val) => {
    if (BigNumber.isBigNumber(val)) {
      try {
        return val.toNumber()
      } catch (error) {
        return val
      }
    } else {
      return Array.isArray(val) ? bn2n(val) : val
    }
  })
