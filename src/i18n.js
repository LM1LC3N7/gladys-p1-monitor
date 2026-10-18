// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They
// never quote a text of the device: only our own words and error codes.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const delay = (ms) =>
  ms >= 60_000
    ? { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` }
    : { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };

/** Our words for an error code of src/p1monitor/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_data: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not a P1 Monitor answer',
    fr: 'réponse qui n’est pas celle d’un P1 Monitor',
  },
  no_data: {
    en: 'no reading of the meter yet',
    fr: 'aucun relevé du compteur pour l’instant',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status = err?.code === 'http' && err.status ? ` ${err.status}` : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

/** The names of the secondary pages, for the status. */
const PAGE = {
  phases: { en: 'phases', fr: 'phases' },
  prices: { en: 'prices', fr: 'prix' },
  water: { en: 'water meter', fr: 'compteur d’eau' },
};

export const T = {
  noAddress: {
    en: 'Enter the address of your P1 Monitor (its IP address on your network, e.g. 192.168.1.40).',
    fr: 'Saisissez l’adresse de votre P1 Monitor (son adresse IP sur votre réseau, ex. 192.168.1.40).',
  },
  badAddress: {
    en: 'The P1 Monitor address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.40).',
    fr: 'L’adresse du P1 Monitor n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.40).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) => ({
    en: [
      `The P1 Monitor at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
      ...notes.map((n) => n.en),
    ].join(' '),
    fr: [
      `Le P1 Monitor à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      ...notes.map((n) => n.fr),
    ].join(' '),
  }),
  noDevice: {
    en: 'P1 Monitor found: create its device from the "Discover" tab to receive its values.',
    fr: 'P1 Monitor trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
  },
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) => ({
    en: [`Connected to the P1 Monitor (${address}).`, ...notes.map((n) => n.en)].join(' '),
    fr: [`Connecté au P1 Monitor (${address}).`, ...notes.map((n) => n.fr)].join(' '),
  }),
  notes: {
    pages: (pages) => ({
      en: `Some pages do not answer (${pages.map((p) => PAGE[p].en).join(', ')}): the other values go on.`,
      fr: `Certaines pages ne répondent pas (${pages.map((p) => PAGE[p].fr).join(', ')}) : les autres valeurs continuent.`,
    }),
    stale: {
      en: 'P1 Monitor gives no new reading of the meter (P1 cable?): the power is no longer sent.',
      fr: 'P1 Monitor ne donne plus de nouveau relevé du compteur (câble P1 ?) : la puissance n’est plus envoyée.',
    },
    noIndex: {
      en: 'The meter gives no index right now: the consumption index waits for it.',
      fr: 'Le compteur ne donne pas d’index en ce moment : l’index de consommation l’attend.',
    },
    held: ({ direction, from, to }) => {
      if (direction === 'down') {
        return {
          en: `The consumption index dropped from ${from} to ${to} kWh: held back, the last accepted value is sent again. If the meter was really replaced or reset, click "Accept the held index" in the configuration of the integration: nothing is billed for the drop, the consumption goes on from there. Saving the configuration accepts nothing.`,
          fr: `L’index de consommation a baissé de ${from} à ${to} kWh : retenu, la dernière valeur acceptée est renvoyée. Si le compteur a vraiment été remplacé ou remis à zéro, cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration : rien n’est facturé pour la baisse, la consommation repart de là. Enregistrer la configuration n’accepte rien.`,
        };
      }
      const kwh = Math.round((to - from) * 1000) / 1000;
      return {
        en: `The consumption index jumped from ${from} to ${to} kWh: held back, not sent to the energy monitoring. If you click "Accept the held index" in the configuration of the integration, ${kwh} kWh will be counted at once as consumption; accept only if this energy was really consumed. Saving the configuration accepts nothing.`,
        fr: `L’index de consommation a sauté de ${from} à ${to} kWh : retenu, non envoyé au suivi énergétique. Si vous cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration, ${kwh} kWh seront comptés d’un coup comme consommation ; n’acceptez que si cette énergie a vraiment été consommée. Enregistrer la configuration n’accepte rien.`,
      };
    },
  },
  accept: {
    nothing: {
      en: 'No consumption index is held back: nothing to accept.',
      fr: 'Aucun index de consommation n’est retenu : rien à accepter.',
    },
    up: ({ from, to }) => {
      const kwh = Math.round((to - from) * 1000) / 1000;
      return {
        en: `Accepted: the index ${to} kWh will be sent at the next read, and ${kwh} kWh (plus what the home uses meanwhile) will be counted at once as consumption. A different value stays held.`,
        fr: `Accepté : l’index ${to} kWh sera envoyé à la prochaine lecture, et ${kwh} kWh (plus ce que le foyer consomme d’ici là) seront comptés d’un coup comme consommation. Une autre valeur reste retenue.`,
      };
    },
    down: ({ from, to }) => ({
      en: `Accepted: the index goes from ${from} down to ${to} kWh at the next read; 0 kWh is counted for the drop, the consumption goes on from there. A different value stays held.`,
      fr: `Accepté : l’index passe de ${from} à ${to} kWh à la prochaine lecture ; 0 kWh est compté pour la baisse, la consommation repart de là. Une autre valeur reste retenue.`,
    }),
  },
  test: {
    ok: (meter) => {
      const power = meter.power === undefined ? '?' : `${meter.power} W`;
      const index =
        meter.consumption.total === undefined
          ? '?'
          : `${Math.round(meter.consumption.total * 1000) / 1000} kWh`;
      return {
        en: `P1 Monitor read: power taken ${power}, consumption index ${index}.`,
        fr: `P1 Monitor lu : puissance prélevée ${power}, index de consommation ${index}.`,
      };
    },
    slow: {
      en: 'The P1 Monitor is slow to answer: look at the integration status in a minute.',
      fr: 'Le P1 Monitor tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
