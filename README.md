# Lido offchain keys experiment (extended)

Inspired by https://github.com/almsh/offchain-keys-playground prototype.

The repository contains two separate contracts: the Submitter contract to simulate the Ether deposit process, and the Node Operators Registry (NOR) contract using Merkle tree roots.

The NOR contract features:

- supports multiple operators
- unlimited number of key's trees per each operator
- each tree can contain a different number of keys (a multiple of degree 2)
- key distribution balancer between operators

Also, helper functions for tests can serve as a starting point for the creation of a toolkit for node operators.

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

Script tries to deposit `200` keys for 3 NOPs using real Deposit contract code.

The scrip will form 2 csv files at repo root: [gas_per_1key_deposit.csv](gas_per_1key_deposit.csv) and [gas_per_1root_add.csv](gas_per_1root_add.csv)

The first one contains the average value of gas spent on the deposit of 1 key at different variations of treeSize \ keysPerBatch.
Second - the average amount of gas spent by the operator to add one Merkle tree root.
