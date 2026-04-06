import { Timestamp } from '@angular/fire/firestore';

export interface Category {
  uid: string;
  name: string;
  description: string;
  icon: string;
  accountId: string;
  date?: string; // 'YYYY-MM-DD'
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
  _pendingSync?: boolean;
}

export interface CategoryCreateInput {
  accountId: string;
  name: string;
  description?: string;
  icon: string;
}

export type CategoryUpdateInput = Partial<
  Pick<Category, 'name' | 'description' | 'icon' | 'accountId'>
>;

/** Icon ids from `sprite.svg` for the category picker. */
export const CATEGORY_ICON_OPTIONS: readonly string[] = [
  'tags',
  'utensils',
  'car-side',
  'entertainment',
  'shopping-bag',
  'bulb',
  'dumbells',
  'wallet',
  'notes',
  'bullseye',
  'bar-graph',
  'credit-card',
  'bank',
  'home',
  'target',
  'office-building',
  'dollar-sign',
  'gift',
  'book-open',
  'paper-airplane',
  'wrench-screwdriver',
  'musical-note',
  'briefcase',
  'face-smile',
  'medicine',
  'earning',
  'carrot',
  'donation',
];

export const DEFAULT_CATEGORIES: Category[] = [
  {
    uid: '1',
    name: 'Food',
    description: 'Food and drinks',
    icon: 'utensils',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '2',
    name: 'Transport',
    description: 'Transport and travel',
    icon: 'car-side',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '3',
    name: 'Entertainment',
    description: 'Entertainment and leisure',
    icon: 'entertainment',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '4',
    name: 'Shopping',
    description: 'Shopping and retail',
    icon: 'shopping-bag',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '5',
    name: 'Bills',
    description: 'Bills and utilities',
    icon: 'bulb',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '6',
    name: 'Health',
    description: 'Health and fitness',
    icon: 'dumbells',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    uid: '7',
    name: 'Income',
    description: 'Income and earnings',
    icon: 'earning',
    accountId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
