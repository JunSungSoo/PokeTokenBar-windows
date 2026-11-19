// Normalizes a MAJOR.MINOR.PATCH tag (optional v prefix) or returns undefined.
export function releaseVersion(tag:string):string|undefined {
 const match=/^[vV]?([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})$/.exec(tag.trim());return match?match.slice(1).map(Number).join('.'):undefined;
}
// True when candidate is a strictly higher valid version than current.
export function newerVersion(candidate:string,current:string):boolean {
 const candidateVersion=releaseVersion(candidate),currentVersion=releaseVersion(current);if(!candidateVersion||!currentVersion)return false;
 const candidateParts=candidateVersion.split('.').map(Number),currentParts=currentVersion.split('.').map(Number);
 for(let i=0;i<3;i++)if(candidateParts[i]!==currentParts[i])return candidateParts[i]!>currentParts[i]!;return false;
}
