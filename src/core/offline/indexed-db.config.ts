import { DBConfig } from 'ngx-indexed-db';

export const indexedDbConfig: DBConfig = {
  name: 'FinTrackrDB',
  /** Bump when adding object stores or indexes so existing DBs run upgrade (e.g. `notifications`). */
  version: 8,
  objectStoresMeta: [
    {
      store: 'accounts',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        // Synthetic per-device index: the local user's uid, stamped on every
        // account row they can see (owned OR member). One index query returns the
        // full visible set — mirrors the `groups` store's `viewerUid` pattern.
        { name: 'viewerUid', keypath: 'viewerUid', options: { unique: false } },
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
      store: 'budgetPlans',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'ownerId', keypath: 'ownerId', options: { unique: false } },
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
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
    {
      store: 'notifications',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'receiverId', keypath: 'receiverId', options: { unique: false } },
        { name: 'accountId', keypath: 'accountId', options: { unique: false } },
        { name: 'status', keypath: 'status', options: { unique: false } },
        { name: 'createdAt', keypath: 'createdAt', options: { unique: false } },
      ],
    },
    {
      store: 'groups',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'viewerUid', keypath: 'viewerUid', options: { unique: false } },
        { name: 'creatorId', keypath: 'creatorId', options: { unique: false } },
      ],
    },
    {
      store: 'group-expenses',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'groupId', keypath: 'groupId', options: { unique: false } },
        { name: 'date', keypath: 'date', options: { unique: false } },
      ],
    },
    {
      store: 'group-settlements',
      storeConfig: { keyPath: 'id', autoIncrement: false },
      storeSchema: [
        { name: 'groupId', keypath: 'groupId', options: { unique: false } },
      ],
    },
  ],
};
