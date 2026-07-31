/* ============================================================
   Quests and dialogue
   ------------------------------------------------------------
   Every callback receives `g`, the quest facade built in
   js/game/questapi.js. Quest progress lives in state.quests[id]
   as { stage, n, set } - stage 0 means "not started".
   ============================================================ */

export const DONE = 900;

/* ---------------- Quest definitions ------------------------- */

export const QUESTS = [
{
  id: 'ward_duties',
  name: 'Ward Duties',
  difficulty: 'Novice',
  length: 'Short',
  qp: 1,
  start: 'Speak to Orderly Punn in the Mercy House, Lumbrisdale.',
  reqs: {},
  desc: 'Matron Vell will not let a new nurse near the Throat until they can '
      + 'dress a wound without fainting. Three patients. Three dressings.',
  stageText: {
    0: 'I could report to the Mercy House in Lumbrisdale. Orderly Punn seems to be in charge of new arrivals.',
    1: g => `Punn wants me to dress the wounds of three bedbound patients. Use a gauze wrap on them. `
          + `(${g.q('ward_duties').n || 0}/3 treated)`,
    2: 'All three are dressed and breathing. I should tell Matron Vell.',
    [DONE]: 'I dressed my first three patients. Matron Vell called me "nurse" without pausing first.'
  },
  rewards: { qp: 1, xp: { triage: 250, suturing: 120, vitality: 100 },
             items: [['gauze_wrap', 5], ['coins', 300], ['linen_body', 1]] },

  onUseOnNpc(g, itemId, npcId) {
    if (g.stage('ward_duties') !== 1) return false;
    if (itemId !== 'gauze_wrap' || npcId !== 'patient_row') return false;
    g.take('gauze_wrap', 1);
    const q = g.q('ward_duties');
    q.n = (q.n || 0) + 1;
    g.xp('triage', 45);
    if (q.n >= 3) {
      g.setStage('ward_duties', 2);
      g.quest('That is the last of them. Matron Vell will want to hear.');
    } else {
      g.quest(`The patient breathes easier. (${q.n}/3)`);
    }
    return true;
  }
},

{
  id: 'ledger_lies',
  name: 'The Ledger Lies',
  difficulty: 'Novice',
  length: 'Short',
  qp: 2,
  start: 'Speak to Matron Vell in the Mercy House.',
  reqs: { quests: ['ward_duties'] },
  desc: 'Doses signed for that were never given. Vell wants the ward ledger '
      + 'that went east to Vellumhaven, and she wants it quietly.',
  stageText: {
    0: 'Matron Vell has the look of a woman who has counted something twice.',
    1: 'The ward ledger was crated off to Vellumhaven. I should search the crates in the Grand Dispensary.',
    2: 'I have the ledger. Back to Vell, and not by the main road.',
    [DONE]: 'The ledger showed forty doses signed out by a hand that was already dead. Vell burned it.'
  },
  rewards: { qp: 2, xp: { salvage: 400, triage: 300 }, items: [['coins', 1200], ['steady_ring', 1]] },

  onSearch(g, objType, x, y) {
    if (g.stage('ledger_lies') !== 1) return false;
    if (objType !== 'crate') return false;
    if (x < 120) return false;                 // Vellumhaven only
    if (g.has('ward_ledger')) return false;
    g.give('ward_ledger', 1);
    g.setStage('ledger_lies', 2);
    g.quest('Under the packing straw: the ward ledger.');
    return true;
  }
},

{
  id: 'fen_passage',
  name: 'Passage to the Fen',
  difficulty: 'Novice',
  length: 'Short',
  qp: 1,
  start: 'Speak to Fenwarden Gob at his hut on the Fen road.',
  reqs: { skills: { foraging: 5 } },
  desc: 'Gob will not let anyone into the deep Fen without a permit, and he '
      + 'will not write a permit for anyone who cannot handle a bile slug.',
  stageText: {
    0: 'Fenwarden Gob guards the Fen road. He looks like he enjoys saying no.',
    1: g => {
      const q = g.q('fen_passage');
      return `Gob wants five bile slugs dealt with and ten lint brought to him. `
           + `(slugs ${q.n || 0}/5, lint ${g.count('lint')}/10)`;
    },
    [DONE]: 'Gob stamped the permit with a thumb and told me the Fen would eat me anyway.'
  },
  rewards: { qp: 1, xp: { foraging: 500, vitality: 200 },
             items: [['fen_permit', 1], ['coins', 600]] },

  onKill(g, npcId) {
    if (g.stage('fen_passage') !== 1 || npcId !== 'bile_slug') return false;
    const q = g.q('fen_passage');
    if ((q.n || 0) >= 5) return false;
    q.n = (q.n || 0) + 1;
    g.quest(`Slug dealt with. (${q.n}/5)`);
    return true;
  }
},

{
  id: 'long_vigil',
  name: 'The Long Vigil',
  difficulty: 'Intermediate',
  length: 'Medium',
  qp: 3,
  start: 'Speak to Sister Ambrose at the Chapel of the Uvula.',
  reqs: { skills: { vigil: 10 }, quests: ['ward_duties'] },
  desc: 'Someone must sit with the dying. Sister Ambrose has sat alone for '
      + 'eleven years and would like, just once, to be relieved.',
  stageText: {
    0: 'Sister Ambrose keeps the vigil in the Uvula chapel. She has not slept properly in a decade.',
    1: g => `Ambrose asked me to keep watch at three separate altars across the Throat. `
          + `(${(g.q('long_vigil').set || []).length}/3 kept)`,
    2: 'The watches are kept. Ambrose wants the tonsil charm back from whatever took it — a spinner in the Fen.',
    3: 'I have the charm. Back to the chapel.',
    [DONE]: 'Ambrose slept. The chapel kept its candles lit anyway.'
  },
  rewards: { qp: 3, xp: { vigil: 2500, triage: 800 }, items: [['vigil_pendant', 1]] },

  onPray(g, x, y) {
    if (g.stage('long_vigil') !== 1) return false;
    const q = g.q('long_vigil');
    q.set = q.set || [];
    const key = x + ',' + y;
    if (q.set.includes(key)) { g.quest('I have already kept watch at this altar.'); return true; }
    q.set.push(key);
    g.xp('vigil', 200);
    if (q.set.length >= 3) {
      g.setStage('long_vigil', 2);
      g.quest('Three watches kept. Something is missing from the last altar — the tonsil charm.');
    } else {
      g.quest(`Watch kept. (${q.set.length}/3)`);
    }
    return true;
  },

  onKill(g, npcId) {
    if (g.stage('long_vigil') !== 2 || npcId !== 'bog_spinner') return false;
    if (g.has('tonsil_charm')) return false;
    if (Math.random() > 0.34) return false;
    g.give('tonsil_charm', 1);
    g.setStage('long_vigil', 3);
    g.quest('Wound into the silk: the tonsil charm.');
    return true;
  }
},

{
  id: 'choking_matron',
  name: 'The Choking Matron',
  difficulty: 'Master',
  length: 'Long',
  qp: 5,
  start: 'Speak to Matron Vell once you have proved yourself on the ward.',
  reqs: { skills: { triage: 20, vitality: 30 }, quests: ['ward_duties', 'ledger_lies'] },
  desc: 'The ward before this one had a Matron too. She is still on shift, '
      + 'somewhere down in the Larynx Deep, and she is still admitting patients.',
  stageText: {
    0: 'Matron Vell has stopped pretending the ledger was the end of it.',
    1: 'Vell says Tomas the Unclosed was there when the old ward fell. He drinks by the Lumbrisdale graves.',
    2: g => `Tomas says the monks in the Heights carry her seals. Three of them will open the Deep. `
          + `(${g.count('choking_seal')}/3)`,
    3: 'Three seals. Sister Ambrose can make them into something that will hold.',
    4: 'Xavin\'s lozenge is warm in my pocket. The Choking Matron waits at the top of the Larynx Deep.',
    5: 'It is done. Matron Vell should hear it from me and not from a runner.',
    [DONE]: 'The old Matron finished her shift. Vell pinned the cape on herself, then handed it to me.'
  },
  rewards: { qp: 5, xp: { triage: 8000, vitality: 5000, vigil: 4000, anatomancy: 3000 },
             items: [['matrons_cape', 1], ['coins', 25000]] },

  onKill(g, npcId) {
    const st = g.stage('choking_matron');
    if (st === 2 && npcId === 'plague_monk') {
      if (g.count('choking_seal') >= 3) return false;
      if (Math.random() > 0.45) return false;
      g.give('choking_seal', 1);
      g.quest(`A wax seal, stamped with a closed windpipe. (${g.count('choking_seal')}/3)`);
      if (g.count('choking_seal') >= 3) {
        g.setStage('choking_matron', 3);
        g.quest('Three seals. Ambrose will know what to do with them.');
      }
      return true;
    }
    if (st === 4 && npcId === 'choking_matron') {
      g.setStage('choking_matron', 5);
      g.quest('She stopped. After all this time, she simply stopped.');
      return true;
    }
    return false;
  }
}
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map(q => [q.id, q]));
/** Live, because content packs may add quests after this module is evaluated. */
export const totalQp = () => QUESTS.reduce((a, q) => a + q.qp, 0);

/* ============================================================
   Dialogue
   ------------------------------------------------------------
   node = { text, who?, opts?, to?, act? }
     text : string | (g) => string
     opts : [{ label, to, if?, act? }]     label may be a function
     to   : auto-advance target when there are no options
     act  : side effect run on entry
   `end` closes the conversation.
   ============================================================ */

const say = (text, to = 'end') => ({ text, to });

export const DIALOGUE = {

/* ---------------- Orderly Punn ------------------------------ */
punn: {
  start(g) {
    const st = g.stage('ward_duties');
    if (st === 0) return 'intro';
    if (st === 1) return 'inprog';
    if (st === 2) return 'gotovell';
    return 'after';
  },
  nodes: {
    intro: { text: 'You must be the new one. Good. We are short, and by "short" I mean it is me.',
      to: 'intro2' },
    intro2: { text: 'Matron Vell will not have you on the floor until you can dress three wounds without '
      + 'going the colour of the ceiling. Beds are through there. Take these.',
      opts: [
        { label: "I'll do it.", to: 'accept' },
        { label: 'What happened to the last new nurse?', to: 'lastone' },
        { label: 'Not right now.', to: 'decline' }
      ] },
    lastone: { text: 'Went north up the Gullet Road on her day off. We kept her locker for a while.',
      to: 'intro2' },
    accept: {
      act: g => {
        g.startQuest('ward_duties');
        g.give('gauze_wrap', 5);
        g.give('rusty_scalpel', 1);
      },
      text: 'Five gauze wraps and a scalpel that has seen things. Use a wrap on each patient. Go on.',
      to: 'end'
    },
    decline: { text: 'The patients will wait. They are extremely good at it.', to: 'end' },
    inprog: { text: g => `Three patients, three wraps. You have done ${g.q('ward_duties').n || 0}. `
      + `Use a gauze wrap on the ones in the beds.`,
      opts: [
        { label: 'I have run out of gauze.', to: 'moregauze' },
        { label: "I'm on it.", to: 'end' }
      ] },
    moregauze: { act: g => g.give('gauze_wrap', 3),
      text: 'Three more. That is the last of my private stash and I want it noted.', to: 'end' },
    gotovell: { text: 'All three? Go and tell the Matron yourself. She likes to see a face.', to: 'end' },
    after: { text: 'Morning, nurse. Half the ward is upright, which is a good half.',
      opts: [
        { label: 'Anything I can do?', to: 'chores' },
        { label: 'Just passing.', to: 'end' }
      ] },
    chores: { text: 'Always. Bring gauze if you make it, and do not die out there. Paperwork.', to: 'end' }
  }
},

/* ---------------- Matron Vell ------------------------------- */
vell: {
  start(g) {
    const cm = g.stage('choking_matron');
    if (cm === 5) return 'cm_finish';
    if (cm >= 1) return 'cm_prog';
    if (g.stage('ledger_lies') === 2) return 'led_finish';
    if (g.stage('ledger_lies') === 1) return 'led_prog';
    if (g.done('ledger_lies') && g.canStart('choking_matron')) return 'cm_intro';
    if (g.done('ward_duties') && g.stage('ledger_lies') === 0) return 'led_intro';
    if (g.stage('ward_duties') === 2) return 'wd_finish';
    return 'idle';
  },
  nodes: {
    idle: { text: 'Wash your hands. Then we can talk.',
      opts: [
        { label: 'Who are you?', to: 'who' },
        { label: 'What is this place?', to: 'place' },
        { label: 'Nothing, Matron.', to: 'end' }
      ] },
    who: { text: 'Matron Vell. I run the last ward in Xavin\'s Throat that still discharges people upright.',
      to: 'idle' },
    place: { text: 'The Mercy House. Forty beds, eleven working. Beyond that door is a world that is '
      + 'slowly closing its own airway.', to: 'idle' },

    wd_finish: {
      act: g => g.completeQuest('ward_duties'),
      text: 'Three dressings, no fainting, and you cleaned up after yourself. Welcome to the ward, nurse.',
      to: 'end' },

    led_intro: { text: 'Since you are useful. Forty doses of greater salve, signed out last winter '
      + 'by Sister Halloway. Halloway died in the autumn.',
      opts: [
        { label: 'Someone is forging her signature.', to: 'led_2' },
        { label: 'Perhaps the dates are wrong.', to: 'led_2' }
      ] },
    led_2: { text: 'The ledger went east with the winter crates, to the Grand Dispensary in Vellumhaven. '
      + 'Bring it back. Do not ask the Guild for it politely; they will say no politely.',
      opts: [
        { label: "I'll find it.", to: 'led_accept' },
        { label: 'That sounds like theft.', to: 'led_theft' }
      ] },
    led_theft: { text: 'It is our ledger. Reclamation. Now, will you go?',
      opts: [{ label: 'Yes.', to: 'led_accept' }, { label: 'No.', to: 'end' }] },
    led_accept: { act: g => g.startQuest('ledger_lies'),
      text: 'Search the crates in the Grand Dispensary. Come back the long way.', to: 'end' },
    led_prog: { text: 'The Grand Dispensary, Vellumhaven. Their crates. Our ledger.', to: 'end' },
    led_finish: { act: g => { g.take('ward_ledger', 1); g.completeQuest('ledger_lies'); },
      text: 'Forty doses. All to the same bed. Bed nine has been empty for two years.', to: 'led_finish2' },
    led_finish2: { text: 'Take this ring. And keep your voice down about bed nine.', to: 'end' },

    cm_intro: { text: 'Sit down. No — sit down. What I am about to say is not ward gossip.',
      to: 'cm_i2' },
    cm_i2: { text: 'Before the Mercy House there was another ward, in the Larynx Deep. It had a Matron. '
      + 'When the Throat closed, she did not evacuate. She kept admitting.',
      opts: [
        { label: 'Kept admitting whom?', to: 'cm_i3' },
        { label: 'That was years ago.', to: 'cm_i3' }
      ] },
    cm_i3: { text: 'Everyone who walks up the Gullet Road. She is still on shift. I would like her '
      + 'to be able to stop.', opts: [
        { label: 'Then I will end the shift.', to: 'cm_accept' },
        { label: 'I need to prepare first.', to: 'end' }
      ] },
    cm_accept: { act: g => { g.startQuest('choking_matron'); g.setStage('choking_matron', 1); },
      text: 'Tomas the Unclosed was carried out of that ward alive. He drinks by the graves. Start there.',
      to: 'end' },
    cm_prog: { text: g => {
      const st = g.stage('choking_matron');
      if (st === 1) return 'Tomas. By the gravestones, south of the chapel. He will be awake; he always is.';
      if (st === 2) return 'Her seals. The monks up in the Heights carry them like rosaries.';
      if (st === 3) return 'Take the seals to Ambrose. She knows the old rites better than she admits.';
      return 'The top of the Larynx Deep. Do not go alone, and do not go unfed.';
    }, to: 'end' },
    cm_finish: { act: g => g.completeQuest('choking_matron'),
      text: 'You did what nobody in eleven years would do. You went down there and you relieved her.',
      to: 'cm_f2' },
    cm_f2: { text: 'This was hers. It should have been mine. It is going to be yours, nurse — Matron.',
      to: 'end' }
  }
},

/* ---------------- Apothecary Dree --------------------------- */
dree: {
  start: () => 'main',
  nodes: {
    main: { text: 'Everything here is labelled. Read the labels. Then read them again.',
      opts: [
        { label: 'Let me see your stock.', to: 'shop' },
        { label: 'How do I brew?', to: 'howto' },
        { label: 'Nothing, thank you.', to: 'end' }
      ] },
    shop: { act: g => g.openShop('apothecary'), text: '', to: 'end' },
    howto: { text: 'Fill a vial with water, add a herb, hold it over a cauldron and hope. '
      + 'Coughcap first. Everyone starts on coughcap.', to: 'main' }
  }
},

/* ---------------- Quartermaster Sceld ----------------------- */
sceld: {
  start: () => 'main',
  nodes: {
    main: { text: 'Signed for, counted twice.',
      opts: [
        { label: 'Show me the stores.', to: 'shop' },
        { label: 'I need tools.', to: 'tools' },
        { label: 'Never mind.', to: 'end' }
      ] },
    shop: { act: g => g.openShop('general'), text: '', to: 'end' },
    tools: { text: 'Tapping knife for the throatwoods. Bone pick for the veins. Net for the pools, '
      + 'gaff for the holes. All on the shelf, all cheap, all yours if you pay.', to: 'main' }
  }
},

/* ---------------- Banker Hollis ----------------------------- */
hollis: {
  start: () => 'main',
  nodes: {
    main: { text: 'Good day. Your account is exactly as you left it.',
      opts: [
        { label: 'Open my bank.', to: 'bank' },
        { label: 'Is it safe here?', to: 'safe' },
        { label: 'Goodbye.', to: 'end' }
      ] },
    bank: { act: g => g.openBank(), text: '', to: 'end' },
    safe: { text: 'Safer than you are. The vault has never been opened by anything with a pulse.', to: 'main' }
  }
},

/* ---------------- Smith Marrow ------------------------------ */
marrow: {
  start: () => 'main',
  nodes: {
    main: { text: 'If it cuts, I made it or I can fix it.',
      opts: [
        { label: 'Show me your wares.', to: 'shop' },
        { label: 'Teach me forging.', to: 'teach' },
        { label: 'Later.', to: 'end' }
      ] },
    shop: { act: g => g.openShop('forge'), text: '', to: 'end' },
    teach: { text: 'Ore to the furnace, bar to the anvil, hammer in your hand. Ironblood is forgiving. '
      + 'Surgical steel is not. Bloodstone will burn you if you hesitate.', to: 'main' }
  }
},

/* ---------------- Sister Ambrose ---------------------------- */
ambrose: {
  start(g) {
    if (g.stage('choking_matron') === 3) return 'cm_seals';
    const st = g.stage('long_vigil');
    if (st === 3) return 'lv_finish';
    if (st >= 1) return 'lv_prog';
    if (g.canStart('long_vigil')) return 'lv_intro';
    return 'idle';
  },
  nodes: {
    idle: { text: 'The candles do not mind the company.',
      opts: [
        { label: 'What is the vigil?', to: 'what' },
        { label: 'I should go.', to: 'end' }
      ] },
    what: { text: 'Someone sits with them at the end so that nobody dies unwitnessed. '
      + 'It is not magic. It only feels like it afterwards.', to: 'idle' },

    lv_intro: { text: 'You have the look. Eleven years I have kept this watch alone. Would you take three of them?',
      opts: [
        { label: 'Three watches. I will.', to: 'lv_accept' },
        { label: 'What does it involve?', to: 'lv_what' },
        { label: 'Not tonight.', to: 'end' }
      ] },
    lv_what: { text: 'You sit at an altar and you do not leave. Three different altars, three different '
      + 'places in the Throat. The Throat notices.', to: 'lv_intro' },
    lv_accept: { act: g => g.startQuest('long_vigil'),
      text: 'Then go. Lumbrisdale chapel, here, and one more that is not in a chapel at all.', to: 'end' },
    lv_prog: { text: g => {
      const st = g.stage('long_vigil');
      if (st === 1) return `Three altars. You have kept ${(g.q('long_vigil').set || []).length}.`;
      if (st === 2) return 'The charm was on the last altar and now it is not. A spinner took it into the Fen.';
      return 'You have it? Show me.';
    }, to: 'end' },
    lv_finish: { act: g => { g.take('tonsil_charm', 1); g.completeQuest('long_vigil'); },
      text: 'Eleven years. Thank you, nurse. I am going to sleep, and I would like you to have this.',
      to: 'end' },

    cm_seals: { text: 'Three of her seals. You want to go down there. Of course you do.',
      opts: [{ label: 'Can you open the way?', to: 'cm_s2' }] },
    cm_s2: { act: g => {
        g.take('choking_seal', 3);
        g.give('xavins_lozenge', 1);
        g.setStage('choking_matron', 4);
      },
      text: 'Wax, thread, and a word I will not repeat. Xavin\'s lozenge. Keep it on you and the Deep '
        + 'will let you leave again. Probably.', to: 'end' }
  }
},

/* ---------------- Fenwarden Gob ----------------------------- */
gob: {
  start(g) {
    const st = g.stage('fen_passage');
    if (st === 1) {
      const q = g.q('fen_passage');
      if ((q.n || 0) >= 5 && g.count('lint') >= 10) return 'fp_finish';
      return 'fp_prog';
    }
    if (g.done('fen_passage')) return 'after';
    return 'fp_intro';
  },
  nodes: {
    fp_intro: { text: 'No permit, no Fen. That is not me being difficult, that is me being tired of '
      + 'fishing people out.',
      opts: [
        { label: 'How do I get a permit?', to: 'fp_how' },
        { label: 'I will go around.', to: 'fp_around' }
      ] },
    fp_how: { text: 'Five bile slugs off my road, and ten lint for my dressings. Do that and you can '
      + 'drown wherever you like.',
      opts: [
        { label: 'Agreed.', to: 'fp_accept' },
        { label: 'That is a strange toll.', to: 'fp_around' }
      ] },
    fp_around: { text: 'You can try. The Fen goes on longer than your legs do.', to: 'end' },
    fp_accept: { act: g => g.startQuest('fen_passage'),
      text: 'Five slugs, ten lint. Come back when your hands are full and your boots are ruined.', to: 'end' },
    fp_prog: { text: g => `Five slugs and ten lint, nurse. You are at ${g.q('fen_passage').n || 0} `
      + `and ${g.count('lint')}.`, to: 'end' },
    fp_finish: { act: g => { g.take('lint', 10); g.completeQuest('fen_passage'); },
      text: 'Slugs gone, lint in hand. Here — stamped, signed, and worth precisely nothing if the Fen '
        + 'decides otherwise.', to: 'end' },
    after: { text: 'Permit-holder. Try not to make me regret it.',
      opts: [
        { label: 'What lives out there?', to: 'lives' },
        { label: 'Nothing. Bye.', to: 'end' }
      ] },
    lives: { text: 'Spinners. Big ones, in the deep water. They take a thing off you and they keep it.', to: 'after' }
  }
},

/* ---------------- Tomas the Unclosed ------------------------ */
tomas: {
  start(g) {
    if (g.stage('choking_matron') === 1) return 'cm_1';
    if (g.stage('choking_matron') >= 2) return 'cm_after';
    return 'idle';
  },
  nodes: {
    idle: { text: 'Eleven years and it still will not close. The nurses gave up. I did not mind.',
      opts: [
        { label: 'Does it hurt?', to: 'hurt' },
        { label: 'Sorry to bother you.', to: 'end' }
      ] },
    hurt: { text: 'Every day. It is the only reliable thing I have got.', to: 'idle' },
    cm_1: { text: 'Vell sent you. She would. Sit down, nurse, this is not a standing story.',
      to: 'cm_1b' },
    cm_1b: { text: 'I was in bed nine when the Throat closed. The old Matron walked the ward with a lamp '
      + 'and told us all to lie still, she would be back.',
      opts: [{ label: 'She never came back?', to: 'cm_1c' }] },
    cm_1c: { text: 'She never left. That is the trouble. She is still walking it. Her seals are on the '
      + 'monks up in the Heights — she gave them out like blessings.',
      to: 'cm_1d' },
    cm_1d: { act: g => g.setStage('choking_matron', 2),
      text: 'Get three. Take them to a woman who knows the old rites. And nurse — when you find her, '
        + 'do not tell her the ward closed. Let her finish her round.', to: 'end' },
    cm_after: { text: 'Three seals. Ambrose. And be kind to her, down there. She was good, once.', to: 'end' }
  }
},

/* ---------------- Bedbound patient -------------------------- */
patient: {
  start(g) {
    if (g.stage('ward_duties') === 1) return 'needy';
    return 'idle';
  },
  nodes: {
    needy: { text: 'Water... or a dressing... whichever is nearer...', to: 'end' },
    idle: { text: 'Bless you, nurse. Bless the whole ward and the roof it is under.',
      opts: [
        { label: 'How are you feeling?', to: 'feel' },
        { label: 'Rest now.', to: 'end' }
      ] },
    feel: { text: 'Better than the ceiling looks.', to: 'idle' }
  }
}

};
