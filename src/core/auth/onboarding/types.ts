export const currencies = [
  { value: 'INR', label: 'INR (₹) - India', isSelected: true },
  { value: 'USD', label: 'USD ($) - United States', isSelected: false },
  { value: 'EUR', label: 'EUR (€) - Eurozone', isSelected: false },
  { value: 'GBP', label: 'GBP (£) - United Kingdom', isSelected: false },
  { value: 'CAD', label: 'CAD ($) - Canada', isSelected: false },
  { value: 'AUD', label: 'AUD ($) - Australia', isSelected: false },
  { value: 'JPY', label: 'JPY (¥) - Japan', isSelected: false },
];

export const budgetSuggestionCards = [
  {
    amount: '1000',
    isSelected: false,
  },
  {
    amount: '2000',
    isSelected: false,
  },
  {
    amount: '3000',
    isSelected: false,
  },
  {
    amount: '5000',
    isSelected: false,
  },
];

export const onboardingPages: {
  sequence: number;
  title: string;
  description: string;
  skippable: boolean;
}[] = [
  {
    sequence: 1,
    title: "Let's setup your profile",
    description: 'tell us a bit about yourself',
    skippable: false,
  },
  {
    sequence: 2,
    title: 'Add your first account',
    description: 'Track where your money lives',
    skippable: false,
  },
  {
    sequence: 3,
    title: 'Choose your currency',
    description: 'This will be your default currency',
    skippable: false,
  },
  {
    sequence: 4,
    title: 'Set a monthy budget',
    description: 'Optional - you can always change this later',
    skippable: true,
  },
  {
    sequence: 5,
    title: 'Set your financial goals',
    description: 'Optional - you can always change this later',
    skippable: true,
  },
];
