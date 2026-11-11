export interface ChildSafetyRecord {
  reports: number;
  population: number;
  abused: number;
  consultations: number;
  valid: number;
  protection: number;
  exploitation: number;
  welfare: number;
  referrals: number;
  other: number;
}

interface PreschoolStatistics {
  total: number;
  categories: Record<string, number>;
}

export interface ChildSafetyData {
  schemaVersion: 1;
  schoolYear: number;
  years: Record<string, Record<string, ChildSafetyRecord>>;
  preschool: Record<string, PreschoolStatistics>;
}

export interface Kindergarten {
  id: string;
  name: string;
  town: string;
  townName: string;
  address: string;
}

export interface Directory {
  year: number;
  records: Kindergarten[];
}

const count = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function validStatistics(data: ChildSafetyData) {
  return data.schemaVersion === 1 && count(data.schoolYear) && Object.keys(data.years).length > 0
    && Object.entries(data.years).every(([year, records]) => /^20\d{2}$/.test(year) && !!records.TW
      && Object.entries(records).every(([code, r]) => (code === 'TW' || /^\d{5}$/.test(code))
        && r.population > 0 && [r.reports, r.population, r.abused, r.consultations, r.valid,
          r.protection, r.exploitation, r.welfare, r.referrals, r.other].every(count)))
    && Object.values(data.preschool).every(r => count(r.total) && Object.values(r.categories).every(count));
}

export function validDirectory(directory: Directory, county: string, year: number) {
  return directory.year === year && Array.isArray(directory.records) && directory.records.every(r =>
    typeof r.id === 'string' && typeof r.name === 'string' && typeof r.address === 'string'
    && typeof r.townName === 'string' && /^\d{8}$/.test(r.town) && r.town.startsWith(county));
}

export async function loadChildSafetyData<T>(file: string, validate: (data: T) => boolean, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(`${import.meta.env.BASE_URL}data/child-safety/${file}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('兒少保護與教保資料載入失敗');
  const data: T = await response.json();
  if (!validate(data)) throw new Error('兒少保護與教保資料格式錯誤');
  return data;
}
