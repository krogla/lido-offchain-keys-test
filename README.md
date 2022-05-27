# Lido offchain keys experiment (extended)

Inspired by https://github.com/almsh/offchain-keys-playground prototype.

The main points that were solved, that were missed in prototype.

1. Limitation of deposit only keys amounts which are multiples of the package size. That is, having a package size of 4 keys, it is impossible to deposit 3 keys.
2. Limitation to make deposits only to one operator per one call. If there are more keys than the free keys amount of operator, it is necessary to form and make other calls.
3. As a consequence of #2, the balancing of key deposits between operators is not taken into account.
4. Limiting one operator to one key tree, which prevents the operator from dynamically adding keys in the future.

## requirements

- nodejs
- npm


## prepare

```sh
git clone https://github.com/krogla/lido-offchain-keys-test
npm i
```

## run tests

```sh
npm run test
```

## get gas compare tables

```sh
npm run gas
```

Script tries to deposit 100 validators keys using real Deposit contract code.

The scrip will form 2 csv files at repo root: `gas_per_1key_deposit.csv` and `gas_per_1root_add.csv`

The first one contains the average value of gas spent on the deposit of 1 key at different variations of treeSize \ keysPerBatch.
Second - the average amount of gas spent by the operator to add one Merkle tree root.