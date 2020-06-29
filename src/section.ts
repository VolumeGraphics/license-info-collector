import { PackageContent } from './package_infos'

export type LicenseMeta<T> = {
  licenseName: string;
  meta: T;
}

export type LicenseSection = {
  licenseName: string;
  libraries: PackageContent[];
}

export type LicenseSectionWithMeta<T> = {
  meta?: T;
} & LicenseSection;

function orderByLicense(packageInfos: PackageContent[]) {
  const getLicenseStr = (a: string) => {
    return a === undefined ? "" : a;
  }

  packageInfos.sort((a: PackageContent, b: PackageContent) => {
    return getLicenseStr(a.license).localeCompare(getLicenseStr(b.license));
  });
}

export function gatherLicenseSections(packageInfos: PackageContent []) {
  orderByLicense(packageInfos);

  const licenseSections: LicenseSection[] = [];
  for(let info of packageInfos) {
    if(licenseSections.length === 0 || licenseSections[licenseSections.length - 1].licenseName !== info.license) {
      licenseSections.push({
        licenseName: info.license,
        libraries: []
      });
    }
    licenseSections[licenseSections.length - 1].libraries.push(info);
  }

  for(let license of licenseSections) {
    license.libraries.sort((a: PackageContent, b: PackageContent) => {
      return a.name.localeCompare(b.name);
    });
  }

  return licenseSections;
}

export function attachMeta<T>(l: LicenseSection[], m: LicenseMeta<T>[]): LicenseSectionWithMeta<T>[] {
  return l.map((ls) => {
    const licenseMeta: LicenseMeta<T> | undefined = m.find((lm) => lm.licenseName === ls.licenseName);
    return {...ls, ...licenseMeta};
  })
}