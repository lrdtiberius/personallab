type AccountReference = { id: string | number; name: string };

const normalizedWords = (value: string) => value
  .toLocaleLowerCase("de-DE")
  .replace(/ä/g, "ae")
  .replace(/ö/g, "oe")
  .replace(/ü/g, "ue")
  .replace(/ß/g, "ss")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .split(/[^a-z0-9]+/)
  .filter(word => word.length >= 3);

export const financeAccountId = (account: AccountReference) => String(account.id);

export function inferFinanceAccountIds(accounts: AccountReference[], groupLabel: string) {
  const groupWords = normalizedWords(groupLabel);
  if (!groupWords.length) return [];
  return accounts
    .filter(account => {
      const accountWords = normalizedWords(account.name);
      return groupWords.some(groupWord => accountWords.some(accountWord => accountWord === groupWord || accountWord.startsWith(groupWord) || groupWord.startsWith(accountWord)));
    })
    .map(financeAccountId);
}

export function orderedFinanceAccounts<T extends AccountReference>(accounts: T[], ids: string[]) {
  const byId = new Map(accounts.map(account => [financeAccountId(account), account]));
  return ids.map(id => byId.get(String(id))).filter((account): account is T => Boolean(account));
}
