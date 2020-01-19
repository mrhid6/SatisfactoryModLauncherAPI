import request from 'request-promise-native';
import { compare } from 'semver';
import { versionSatisfiesAll } from './utils';
import { ModNotFoundError } from './errors';

const API_URL = 'https://api.ficsit.app';
const GRAPHQL_API_URL = `${API_URL}/v2/query`;

export async function fiscitApiQuery(query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variables?: { [key: string]: any }): Promise<{ [key: string]: any }> {
  try {
    const response = JSON.parse(await request(GRAPHQL_API_URL, {
      method: 'POST',
      body: JSON.stringify({
        query,
        variables,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return response.data;
  } catch (e) {
    return JSON.parse(e.error);
  }
}

interface FicsitAppFetch {
  time: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

const cachedFetch: { [requestID: string]: FicsitAppFetch } = {};
const fetchCooldown = 5 * 60 * 1000;

function cooldownPassed(action: string): boolean {
  return cachedFetch[action] ? Date.now() - cachedFetch[action].time > fetchCooldown : true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCache(action: string): any {
  return cachedFetch[action]?.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCache(action: string, data: any): void {
  cachedFetch[action] = {
    time: Date.now(),
    data,
  };
}


export interface FicsitAppMod {
  id: string;
  name: string;
  short_description: string;
  full_description: string;
  logo: string;
  source_url: string;
  views: number;
  downloads: number;
  hotness: number;
  popularity: number;
  last_version_date: Date;
  authors: Array<FicsitAppAuthor>;
  versions: Array<FicsitAppVersion>;
}

export interface FicsitAppVersion {
  mod_id: string;
  version: string;
  sml_version: string;
  changelog: string;
  downloads: string;
  stability: 'alpha' | 'beta' | 'release';
  link: string;
}

export interface FicsitAppAuthor {
  mod_id: string;
  user: FicsitAppUser;
  role: string;
}

export interface FicsitAppUser {
  username: string;
  avatar: string;
}

export async function getModDownloadLink(modID: string, version: string): Promise<string> {
  const requestID = `getModDownloadLink_${modID}_${version}`;
  if (cooldownPassed(requestID)) {
    const res = await fiscitApiQuery(`
    query($modID: ModID!, $version: String!){
      getMod(modId: $modID)
      {
        version(version: $version)
        {
          link
        }
      }
    }
    `, { modID, version });
    if (res.errors) {
      throw res.errors;
    } else if (res.getMod && res.getMod.version) {
      setCache(requestID, API_URL + res.getMod.version.link);
    } else {
      throw new ModNotFoundError(`${modID}@${version} not found`);
    }
  }
  return getCache(requestID);
}

export async function getAvailableMods(): Promise<Array<FicsitAppMod>> {
  const requestID = 'getAvailableMods';
  if (cooldownPassed(requestID)) {
    const res = await fiscitApiQuery(`
    {
      getMods(filter: {
        limit: 100
      })
      {
        mods
        {
          name,
          short_description,
          full_description,
          id,
          authors
          {
            mod_id,
            user
            {
              username,
              avatar
            },
            role
          },
          versions
          {
            mod_id,
            version,
            sml_version,
            changelog,
            downloads,
            stability,
            link
          }
        }
      }
    }
    `);
    if (res.errors) {
      throw res.errors;
    } else {
      setCache(requestID, res.getMods.mods);
    }
  }
  return getCache(requestID);
}

export async function getMod(modID: string): Promise<FicsitAppMod> {
  const requestID = `getMod_${modID}`;
  if (cooldownPassed(requestID)) {
    const res = await fiscitApiQuery(`
    query($modID: ModID!){
      getMod(modId: $modID)
      {
          name,
          short_description,
          full_description,
          id,
          logo,
          authors
          {
            mod_id,
            user
            {
              username,
              avatar
            },
            role
          },
          versions
          {
            mod_id,
            version,
            sml_version,
            changelog,
            downloads,
            stability,
            link
          }
      }
    }
    `, {
      modID,
    });
    if (res.errors) {
      throw res.errors;
    } else {
      setCache(requestID, res.getMod);
    }
  }
  return getCache(requestID);
}

export async function getModVersions(modID: string): Promise<Array<FicsitAppVersion>> {
  const requestID = `getModVersions_${modID}`;
  if (cooldownPassed(requestID)) {
    const res = await fiscitApiQuery(`
      query($modID: ModID!){
        getMod(modId: $modID)
        {
            name,
            id,
            versions(filter: {
                limit: 100
              })
            {
              mod_id,
              version,
              sml_version,
              changelog,
              downloads,
              stability,
              link
            }
        }
      }
      `, {
      modID,
    });
    if (res.errors) {
      throw res.errors;
    } else if (res.getMod) {
      setCache(requestID, res.getMod.versions);
    } else {
      throw new ModNotFoundError(`Mod ${modID} not found`);
    }
  }
  return getCache(requestID);
}

export async function getModLatestVersion(modID: string): Promise<FicsitAppVersion> {
  const versions = await getModVersions(modID);
  versions.sort((a, b) => -compare(a.version, b.version));
  return versions[0];
}

export async function findVersionMatchingAll(modID: string,
  versionConstraints: Array<string>): Promise<string | undefined> {
  const modInfo = await getMod(modID);
  let finalVersion = '';
  let found = false;
  modInfo.versions.forEach((modVersion) => {
    if (!found && versionSatisfiesAll(modVersion.version, versionConstraints)) {
      found = true;
      finalVersion = modVersion.version;
    }
  });
  return found ? finalVersion : undefined;
}


export interface FicsitAppSMLVersion {
  id: string;
  version: string;
  satisfactory_version: number;
  stability: 'alpha' | 'beta' | 'release';
  link: string;
  changelog: string;
  date: string;
}

export async function getAvailableSMLVersions(): Promise<Array<FicsitAppSMLVersion>> {
  const requestID = 'getSMLVersions';
  if (cooldownPassed(requestID)) {
    const res = await fiscitApiQuery(`
    {
      getSMLVersions(filter: {limit: 100})
      {
        sml_versions
        {
          id,
          version,
          satisfactory_version
          stability,
          link,
          changelog,
          date
        }
      }
    }
    `);
    if (res.errors) {
      throw res.errors;
    } else {
      setCache(requestID, res.getSMLVersions.sml_versions);
    }
  }
  return getCache(requestID);
}

export async function getSMLVersionInfo(version: string): Promise<FicsitAppSMLVersion | undefined> {
  const versions = await getAvailableSMLVersions();
  return versions.find((smlVersion) => smlVersion.version === version);
}

export async function getLatestSMLVersion(): Promise<FicsitAppSMLVersion> {
  const versions = await getAvailableSMLVersions();
  versions.sort((a, b) => -compare(a.version, b.version));
  return versions[0];
}

export async function findAllVersionsMatchingAll(modID: string,
  versionConstraints: Array<string>): Promise<Array<string>> {
  if (modID === 'SML') {
    const smlVersions = await getAvailableSMLVersions();
    return smlVersions
      .filter((smlVersion) => versionSatisfiesAll(smlVersion.version, versionConstraints))
      .map((smlVersion) => smlVersion.version);
  }
  const modInfo = await getMod(modID);
  return modInfo.versions
    .filter((modVersion) => versionSatisfiesAll(modVersion.version, versionConstraints))
    .map((modVersion) => modVersion.version);
}
