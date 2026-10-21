/** Род в текстах по анкете: «занимался / занималась». Пол не указан — мужская форма, как в большинстве приложений */
let sex: string | null = null;
export const setSex = (s: string | null | undefined) => { sex = s ?? null; };
export const g = (m: string, f: string) => (sex === 'f' ? f : m);
