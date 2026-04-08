import { DBConfig } from 'ngx-indexed-db';

export const indexedDbConfig: DBConfig = {
  name: 'FinTrackrDB',
  /** Bump when adding object stores or indexes so existing DBs run upgrade (e.g. `monthly-reports`). */
  version: 3,
  objectStoresMeta: [
    {
      store: 'accounts',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'ownerId', keypath: 'ownerId', options: { unique: false } },
        { name: 'updatedAt', keypath: 'updatedAt', options: { unique: false } },
      ],
    },
    {
      store: 'transactions',
      storeConfig: { keyPath: 'uid', autoIncrement: false },
      storeSchema: [
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'type', keypath: 'type', options: { unique: false } },
        { name: 'category', keypath: 'category', options: { unique: false } },
        { name: 'createdAt', keypath: 'createdAt', options: { unique: false } },
      ],
    },
    {
      store: 'recurring-transactions',
      storeConfig: { keyPath: 'uid', autoIncrement: false },
      storeSchema: [
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'transactionId', keypath: 'transactionId', options: { unique: false } },
      ],
    },
    {
      store: 'budgets',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'ownerId', keypath: 'ownerId', options: { unique: false } },
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'month', keypath: 'month', options: { unique: false } },
      ],
    },
    {
      store: 'goals',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'ownerId', keypath: 'ownerId', options: { unique: false } },
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
      ],
    },
    {
      store: 'categories',
      storeConfig: { keyPath: 'uid', autoIncrement: false },
      storeSchema: [
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'name', keypath: 'name', options: { unique: false } },
      ],
    },
    {
      store: 'sync-queue',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'storeName', keypath: 'storeName', options: { unique: false } },
        { name: 'operation', keypath: 'operation', options: { unique: false } },
        { name: 'timestamp', keypath: 'timestamp', options: { unique: false } },
        { name: 'status', keypath: 'status', options: { unique: false } },
      ],
    },
    {
      store: 'sync-metadata',
      storeConfig: { keyPath: 'key', autoIncrement: false },
      storeSchema: [],
    },
    {
      store: 'monthly-reports',
      storeConfig: { keyPath: 'uid', autoIncrement: false },
      storeSchema: [
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'month', keypath: 'month', options: { unique: false } },
      ],
    },
  ],
};
