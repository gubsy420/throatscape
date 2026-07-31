/* ============================================================
   Shops - what the Throat will sell you, and for how much
   ============================================================ */

export const SHOPS = {
  general: {
    id: 'general', name: "Sceld's Ward Stores",
    greeting: 'Signed for, counted twice. What do you need?',
    buyMult: 1.0, sellMult: 0.42,
    stock: [
      ['gauze_wrap', 25], ['vial', 60], ['bucket', 8], ['needle', 12],
      ['gut_thread', 200], ['tap_knife', 6], ['bone_pick', 6], ['leech_net', 6],
      ['fishing_gaff', 3], ['pestle', 6], ['smith_hammer', 6], ['rusty_scalpel', 8],
      ['linen_helm', 4], ['linen_body', 4], ['linen_legs', 4], ['linen_gloves', 4],
      ['linen_boots', 4], ['dart_syringe', 400], ['brass_syringe', 4], ['bones', 0]
    ]
  },

  apothecary: {
    id: 'apothecary', name: "Dree's Dispensary",
    greeting: 'Everything here is labelled. Read the labels.',
    buyMult: 1.05, sellMult: 0.45,
    stock: [
      ['vial_of_water', 150], ['salve_mending', 25], ['honey_lozenge', 40],
      ['antivenin', 8], ['mend_rune', 800], ['flesh_rune', 800], ['nerve_rune', 350],
      ['bile_rune', 150], ['vital_rune', 40], ['staff_of_sutures', 4],
      ['coughcap', 12], ['sootleaf', 8], ['vial', 80]
    ]
  },

  forge: {
    id: 'forge', name: "Marrow's Forge",
    greeting: 'If it cuts, I made it or I can fix it.',
    buyMult: 1.0, sellMult: 0.40,
    stock: [
      ['ironblood_bar', 14], ['steel_bar', 6], ['smith_hammer', 10],
      ['bone_pick', 10], ['tap_knife', 10], ['reflex_hammer', 6],
      ['steel_scalpel', 4], ['ironblood_helm', 2], ['ironblood_body', 2],
      ['ironblood_legs', 2], ['ironblood_ward', 2], ['dart_syringe', 200]
    ]
  }
};

/** Price the shop charges you. */
export const buyPrice = (shop, itemValue) =>
  Math.max(1, Math.round(itemValue * shop.buyMult));

/** Price the shop pays you. Quest items are worthless to everyone. */
export const sellPrice = (shop, itemValue) =>
  Math.max(0, Math.floor(itemValue * shop.sellMult));
