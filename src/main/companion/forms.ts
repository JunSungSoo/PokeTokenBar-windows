// Form order and PokéAPI sprite variety IDs from macOS PokemonForm.swift at deaf07e.
const catalog: Record<number, [string, number | null][]> = {
  201: [...'abcdefghijklmnopqrstuvwxyz', 'exclamation', 'question'].map(form => [form, null]),
  351: [["normal", null], ["sunny", 10013], ["rainy", 10014], ["snowy", 10015]],
  386: [["normal", null], ["attack", 10001], ["defense", 10002], ["speed", 10003]],
  412: [["plant", null], ["sandy", null], ["trash", null]],
  413: [["plant", null], ["sandy", 10004], ["trash", 10005]],
  421: [["overcast", null], ["sunshine", null]],
  422: [["west", null], ["east", null]],
  423: [["west", null], ["east", null]],
  479: [["normal", null], ["heat", 10008], ["wash", 10009], ["frost", 10010], ["fan", 10011], ["mow", 10012]],
  487: [["altered", null], ["origin", 10007]],
  492: [["land", null], ["sky", 10006]],
  493: [["normal", null], ["fighting", null], ["flying", null], ["poison", null], ["ground", null], ["rock", null], ["bug", null], ["ghost", null], ["steel", null], ["fire", null], ["water", null], ["grass", null], ["electric", null], ["psychic", null], ["ice", null], ["dragon", null], ["dark", null], ["fairy", null]],
  550: [["red-striped", null], ["blue-striped", 10016]],
  555: [["standard", null], ["zen", 10017]],
  585: [["spring", null], ["summer", null], ["autumn", null], ["winter", null]],
  586: [["spring", null], ["summer", null], ["autumn", null], ["winter", null]],
  641: [["incarnate", null], ["therian", 10019]],
  642: [["incarnate", null], ["therian", 10020]],
  645: [["incarnate", null], ["therian", 10021]],
  646: [["normal", null], ["black", 10022], ["white", 10023]],
  647: [["ordinary", null], ["resolute", 10024]],
  648: [["aria", null], ["pirouette", 10018]],
  649: [["normal", null], ["douse", null], ["shock", null], ["burn", null], ["chill", null]],
};

export function appearance(speciesID: number, chosen?: string) {
  const entries = catalog[speciesID];
  const selected = entries?.find(([form]) => form === chosen) ?? entries?.[0];
  if (!selected) return {};
  const [form, variety] = selected;
  const animated = selected === entries[0] ? String(speciesID) : speciesID + '-' + form;
  return { form, spriteID: variety ? String(variety) : animated, animated };
}

export function lineForms(base: number, route: number[]): string[] {
  // These species carry one appearance through the evolution line.
  const related: Record<number, number[]> = { 412: [413], 420: [421], 422: [423], 554: [555], 585: [586] };
  return [...new Set([base, ...route.slice(1), ...(related[base] ?? [])].flatMap(id =>
    catalog[id]?.map(([form]) => form) ?? []))];
}

/** Read-only form list for collection counters and default-form artwork. */
export const formCatalog: Record<number, string[]> = Object.fromEntries(Object.entries(catalog).map(([id,forms]) => [id,forms.map(([name])=>name)]));
