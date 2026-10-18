# P1 Monitor pour Gladys Assistant

Intégration **non officielle**, sans lien avec P1 Monitor (ztatz). Elle lit
**P1 Monitor**, le logiciel (souvent sur un Raspberry Pi) branché sur le port
P1 de votre compteur intelligent (Belgique, Pays-Bas), **par son API locale**,
sans cloud ni compte.

> **Jamais testé avec un vrai P1 Monitor.** L'intégration a été écrite
> d'après la bibliothèque p1monitor (utilisée par Home Assistant) et des
> réponses simulées. Vos retours sur le forum Gladys sont les bienvenus.

### Ce n'est pas…

- l'intégration **DSMR Reader** (de GBoulvin), qui lit un autre logiciel,
  DSMR Reader ;
- l'intégration **YouLess**, qui lit le boîtier YouLess ;
- l'intégration **HomeWizard**, qui lit le boîtier HomeWizard (P1 Meter).

Utilisez celle qui correspond à ce qui est branché sur votre compteur : deux
d'entre elles sur le même compteur compteraient deux fois la consommation dans
le suivi énergétique.

## Ce que vous obtenez

Un appareil « P1 Monitor », avec seulement ce que votre compteur fournit :

| Valeur                                                           | Rythme | Type dans Gladys                                 |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------ |
| Puissance prélevée (W)                                           | 10 s   | capteur d'énergie, puissance                     |
| Puissance injectée (W)                                           | 10 s   | capteur simple                                   |
| Index de consommation (kWh) : tarif bas + tarif haut             | 1 min  | capteur d'énergie, **index** : suivi énergétique |
| Index de consommation par tarif, bas et haut (kWh)               | 1 min  | capteurs simples                                 |
| Index d'injection, total et par tarif (kWh)                      | 1 min  | capteurs simples, **jamais facturés**            |
| Tarif en cours (1 = bas, 2 = haut)                               | 1 min  | capteur simple                                   |
| Par phase : puissance prélevée et injectée (W), tension, courant | 10 s   | capteurs sans historique par défaut              |
| Gaz (m³)                                                         | 1 min  | capteur de volume, **hors suivi énergétique**    |
| Eau (m³), si un compteur d'eau est branché à P1 Monitor          | 5 min  | capteur de volume, **hors suivi énergétique**    |
| Prix réglés dans P1 Monitor (€/kWh, €/m³)                        | 15 min | capteurs simples                                 |

Le **suivi énergétique** de Gladys calcule lui-même la consommation par
demi-heure et son coût à partir de l'index de consommation (tarif bas + tarif
haut du compteur, deux index cumulés : jamais un total du jour, jamais
l'injection). L'injection, le gaz et l'eau restent à part : Gladys facturerait
le gaz au tarif de l'électricité, et l'injection serait comptée comme une
consommation. Les prix de P1 Monitor sont seulement affichés : le coût dans
Gladys vient de vos contrats d'énergie Gladys.

Les noms « tarif bas » et « tarif haut » sont ceux de P1 Monitor (`LOW` et
`HIGH`, « dal » et « piek » ; code tarif `D` ou `P`). Sur un compteur belge,
où le tarif 1 est le jour, vérifiez lequel correspond à votre facture (non
vérifié).

## Installation

1. Donnez à l'appareil où tourne P1 Monitor une **adresse IP fixe** dans
   votre box : l'appareil Gladys est reconnu par cette adresse (la changer
   crée un nouvel appareil).
2. Dans Gladys, installez l'intégration P1 Monitor depuis le store, ouvrez sa
   configuration et saisissez l'**adresse** (ex. `192.168.1.40`, avec `:port`
   seulement s'il n'est pas 80).
3. Cliquez sur **Tester la connexion** : la puissance et l'index lus
   s'affichent.
4. Dans l'onglet **Découverte**, créez l'appareil P1 Monitor. Les valeurs
   arrivent aussitôt.

L'API est lue en HTTP simple sur votre réseau, sans mot de passe (comme le
fait Home Assistant) ; le HTTPS de P1 Monitor n'est pas utilisé.

## Bon à savoir

- **P1 Monitor injoignable** : l'état de l'intégration le dit, et elle
  réessaie après 10 s, puis 20 s, 40 s… jusqu'à 5 minutes, sans jamais se
  bloquer. Enregistrer la configuration relance tout de suite.
- **Pages secondaires** (phases, prix, compteur d'eau) en panne : la
  puissance et les index continuent ; l'état le signale, et la page est
  réessayée toutes les 5 minutes. Sans compteur d'eau, la page de l'eau n'est
  redemandée qu'une fois par heure (un compteur ajouté plus tard apparaît).
- **Relevé figé** : si P1 Monitor renvoie le même relevé du compteur pendant
  5 minutes (câble P1 débranché, lecture arrêtée), la puissance et les phases
  ne sont plus envoyées (elles paraîtraient actuelles) et l'état le signale.
- **Index de consommation protégé** (Gladys compte chaque remontée en
  entier) :
  - un index à 0 n'est jamais envoyé, ni une somme partielle (un tarif
    manquant : aucun index) ; les index par tarif, d'injection, le gaz et
    l'eau ne sont jamais envoyés à 0 non plus ;
  - une **baisse** (compteur remplacé) n'est acceptée qu'après 60 minutes de
    valeurs non nulles et qui ne baissent plus ; la consommation de ces
    60 minutes d'attente est perdue ;
  - un **saut vers le haut** (plus de 100 kW en moyenne depuis la dernière
    valeur) n'est **jamais** accepté tout seul, ni par répétition, ni par le
    temps qui passe, ni par un redémarrage : toute valeur égale ou supérieure
    reste retenue (la retenue est gardée dans `/data`), la dernière valeur
    acceptée est renvoyée à Gladys, et l'état de l'intégration affiche le
    saut. S'il est juste, **enregistrez la configuration** de l'intégration :
    l'index en cours est alors accepté, et la différence est **comptée une
    fois** comme consommation.
- Les valeurs inchangées ne sont renvoyées que toutes les 10 minutes ; à
  chaque reconnexion à Gladys, l'appareil, toutes ses valeurs et l'état sont
  publiés à nouveau.
- Les caractéristiques de l'appareil sont figées à sa création : si une
  valeur apparaît plus tard (premiers panneaux solaires, compteur d'eau),
  cliquez sur « Mettre à jour » dans l'onglet Découverte : les nouvelles
  valeurs arrivent aussitôt. L'appareil republié ne perd jamais une
  caractéristique de l'appareil créé, même si une valeur manque un moment.
- L'injection (puissance, index, prix d'injection) n'apparaît qu'une fois
  qu'elle vaut plus de 0 : un foyer sans panneaux ne voit pas ces valeurs.

## Limites

- Un seul P1 Monitor par installation de l'intégration.
- Les tarifs dynamiques et l'historique de P1 Monitor ne sont pas lus.
- Pas d'accès protégé (mot de passe, HTTPS) : l'API locale doit être
  joignable en HTTP depuis Gladys.

## Crédits

Lecture de l'API portée de
[p1monitor](https://github.com/klaasnicolaas/python-p1monitor) (MIT, Klaas
Schoute). P1 Monitor est un logiciel de ztatz. Code de l'intégration sous
licence Apache-2.0.
