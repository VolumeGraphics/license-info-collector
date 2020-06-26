import * as path from 'path'
import * as fs from 'fs'
import * as semver from 'semver'
import { License } from './section';

export interface Author {
  name?: string;
  email?: string;
  url?: string;
}

interface DeprecatedLicense {
  type?: string;
  url?: string;
}

interface DeprecatedContent {
  licenses?: DeprecatedLicense[];
  license?: DeprecatedLicense;
}

export interface Repository {
  type: string;
  url: string;
}

export interface PackageContent {
  name: string;
  version: string;
  packageJson: string[];
  contributors?: (string | Author)[];
  author?: string | Author;
  description?: string;
  repository?: string | Repository;
  homepage?: string;
  license?: string;
}

export interface Dependency {
  [index: string]: string;
}

export interface RawPackageDependencies {
  dependencies?: Dependency;
  devDependencies?: Dependency;
  optionalDependencies?: Dependency;
}

export interface PackageDependencies {
  packageDependencies: PackageContent[];
  packageDevDependencies: PackageContent[];
  packageOptionalDependencies: PackageContent[];
}

export interface InvalidPackageContent {
  copyright: PackageContent[];
  license: PackageContent[];
}

function isSamePackageContent(left: PackageContent, right: PackageContent) {
  return left.name === right.name && left.version === right.version;
}

function groupSameContents<T extends (PackageContent)>(contents: T[]): T[] {
  let uniques: T[] = [];
  contents.forEach((content) => {
    let foundUniqueItem = uniques.find((uniqueItem) => {
      return content !== uniqueItem && isSamePackageContent(content, uniqueItem);
    });
    if(foundUniqueItem === undefined) {
      uniques.push(content);
      return;
    }
    foundUniqueItem.packageJson = foundUniqueItem.packageJson.concat(content.packageJson);
  });

  return uniques;
}

function getPackageFileFromDirectory (dir: string) {
  let files: string[] = [];
  const directoryItems = fs.readdirSync(dir);
  for (let directoryItem of directoryItems) {
    const absItem = path.join(dir, directoryItem);
    if (fs.statSync(absItem).isDirectory()) {
      files = files.concat(getPackageFileFromDirectory(absItem));
    } else {
      if (directoryItem !== "package.json") {
        continue;
      }
      files.push(absItem);
    }
  }

  return files;
}

function getPackageFiles (nodeModulePaths: string[]) {
  const paths: string[] = [];
  for(const nodeModulesPath of nodeModulePaths) {
    paths.push(...getPackageFileFromDirectory(nodeModulesPath));
  }
  return paths;
}

interface DependencyResults {
  foundPackages: (PackageContent & RawPackageDependencies)[];
  missing: Dependency;
}

function resolve (dependencies: Dependency, contents: (PackageContent & RawPackageDependencies)[], disableNpmVersionCheck: boolean) {
  let result: DependencyResults = {
    foundPackages: [],
    missing: {}
  };
  for(let packageName in dependencies) {
    const versionSemanticString = dependencies[packageName];
    const referencedLib = contents.find((pack) => {
      if (pack.name !== packageName)
        return false;
      
      if (pack.version === versionSemanticString)
        return true;
      
      if (disableNpmVersionCheck)
        return false;
      
      try {
        return semver.satisfies(pack.version, versionSemanticString)
      } catch (e) {
        return false;
      }
    });
    if (referencedLib === undefined) {
      result.missing[packageName] = dependencies[packageName];
    } else {
      result.foundPackages.push(referencedLib);
    }
  }
  return result;
};

function resolveRawDependencies(contents: (PackageContent & RawPackageDependencies)[], disableNpmVersionCheck: boolean): (PackageContent & RawPackageDependencies & PackageDependencies)[] {

  return contents.map((content) => {

    const resolvedDependencies: PackageDependencies = {
      packageDependencies: resolve(content.dependencies, contents, disableNpmVersionCheck).foundPackages,
      packageDevDependencies: resolve(content.devDependencies, contents, disableNpmVersionCheck).foundPackages,
      packageOptionalDependencies: resolve(content.optionalDependencies, contents, disableNpmVersionCheck).foundPackages
    };

    return Object.assign(content, resolvedDependencies);
  });
}

function removeUnreferencedContents(contents: (PackageContent & PackageDependencies & RawPackageDependencies)[], targetPackage: (PackageContent & PackageDependencies & RawPackageDependencies)) {
  return contents.filter((content) => {
    if(content === targetPackage) {
      return true;
    }
    for(let c of contents) {
      if(c === content)
        continue;
      
      if(c.packageDependencies.includes(content) || c.packageDevDependencies.includes(content) || c.packageOptionalDependencies.includes(content))
        return true;
    }
    return false;
  });
}

export function collectPackageInfos(productPackageJson: string, nodeModulePaths: string[], disableNpmVersionCheck: boolean): (PackageContent & PackageDependencies & RawPackageDependencies)[] {

  const transformDeprecatedContent = (content: PackageContent, deprecatedContent: DeprecatedContent) => {
    if(content.license && typeof content.license === "string") {
      return;
    }

    if(deprecatedContent.license !== undefined && deprecatedContent.license.type !== undefined) {
      if(!deprecatedContent.licenses)
        deprecatedContent.licenses = []
      deprecatedContent.licenses.push(deprecatedContent.license);
    }

    if(!deprecatedContent.licenses) {
      return;
    }

    const types:string[] = [];
    for(let license of deprecatedContent.licenses) {
      if(!license.type)
        continue;
        
      types.push(license.type);
    }

    if(types.length > 1) {
      content.license = "(" + types.join(" OR ") + ")";
      return;
    }

    if(types.length === 1) {
      content.license = types[0];
    }
  };

  const createPackageContent = (packageFilePath: string) => {
    const fileContents = fs.readFileSync(packageFilePath).toString();
    const contents = JSON.parse(fileContents);

    const packageContent: PackageContent & RawPackageDependencies = contents;
    packageContent.packageJson = [packageFilePath];
    transformDeprecatedContent(packageContent, contents);
    
    return packageContent;
  };

  let contents: (PackageContent & RawPackageDependencies)[] = getPackageFiles(nodeModulePaths).map(createPackageContent);

  contents = groupSameContents(contents);
  contents.push(createPackageContent(productPackageJson));
  const resolvedContents = resolveRawDependencies(contents, disableNpmVersionCheck);
  const referencedContents = removeUnreferencedContents(resolvedContents, resolvedContents[resolvedContents.length - 1]);

  return referencedContents;
}

export function findInvalidPackageContent(
  packageContents: (PackageContent & PackageDependencies)[], 
  allowedLicenses: License[], 
  evaluateCopyrightInfo: (content: PackageContent) => boolean
) {

const invalid: InvalidPackageContent = {
  copyright: [],
  license: []
}
for(let content of packageContents) {
  if(!allowedLicenses.find( (l: License) => { return l.name === content.license; } )) {
    invalid.license.push(content);
  }

  if(evaluateCopyrightInfo(content) === false) {
    invalid.copyright.push(content);
  }
}
return invalid;
}

export interface MissingPackages {
  packageReference: PackageContent & PackageDependencies & RawPackageDependencies,
  missingDependencies: Dependency,
  missingDevDependencies: Dependency,
  missingOptionalDependencies: Dependency
}

export function findMissingPackages(contents: (PackageContent & PackageDependencies & RawPackageDependencies)[], disableNpmVersionCheck: boolean): MissingPackages[]
{
  const missing: MissingPackages[] = [];

  for (const content of contents) {

    const missingDependencies = resolve(content.dependencies, contents, disableNpmVersionCheck).missing;
    const missingDevDependencies = resolve(content.devDependencies, contents, disableNpmVersionCheck).missing;
    const missingOptionalDependencies = resolve(content.optionalDependencies, contents, disableNpmVersionCheck).missing;

    if ( Object.keys(missingDependencies).length !== 0
      || Object.keys(missingDevDependencies).length !== 0
      || Object.keys(missingOptionalDependencies).length !== 0) {
      
      missing.push({
        packageReference: content,
        missingDependencies: missingDependencies,
        missingDevDependencies: missingDevDependencies,
        missingOptionalDependencies: missingOptionalDependencies
      });
    }
  }

  return missing;
}
