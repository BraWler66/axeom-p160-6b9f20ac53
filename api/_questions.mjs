// The questions Jev answers for every incoming message. Shared by the evaluation script and the live API function.
export const INTENTS = {
  edit_request: 'The client asks for a specific change to one of their videos (music, captions, which shot, blur a face, cut part, add or remove text, colours, logo, spelling of their name).',
  followup: 'The client says a change they asked for earlier still is not done, or asks again ("still wrong", "second time I ask", "did anyone see my message").',
  changed_mind: 'The client approved a video earlier and now changes their mind and wants it redone.',
  churn_risk: 'The client hints they may stop, pause, leave, reconsider or renegotiate the contract, or says they are unhappy with the service.',
  opportunity: 'Possible new revenue: a referral, a question about prices for a new service, wanting more or recurring work.',
  payment: 'About paying, invoices, billing, money owed, or who should be billed.',
  standing_instruction: 'A rule for all future work, or new contact details (new phone, new email, new business name).',
  approval: 'The client approves a video for posting.',
  praise: 'Thanks or a compliment, with nothing to do.',
  logistics: 'Scheduling and shoot logistics: running late, parking, what to bring, rescheduling or cancelling a shoot.',
  spam: 'Spam, scam, phishing, or an unrelated sales pitch from someone who is not a client.'
};
export const EDIT_TYPES = {
  brand_color: 'Use a different brand colour.',
  calmer_music: 'Change the song to a calmer, less hype one.',
  outside_shot: 'Use a different shot / angle (for example the outside one).',
  blur_face: 'Blur someone\'s face (no release signed).',
  phone_end: 'Add the phone number at the end.',
  cut_start: 'Cut the slow start / first seconds.',
  music_lower: 'Music is too loud, lower it.',
  remove_prices: 'Remove the part that mentions prices.',
  bigger_captions: 'Make the captions bigger.',
  name_spelling: 'The business name is spelled wrong.',
  cut_stumble: 'Remove a stumble or mistake in speech.',
  add_line: 'Add a line of text or a call to action at the end (for example "walk-ins welcome").',
  other_edit: 'Some other change to the video (for example a new logo, new intro).',
  none: 'The message does not ask for a change to a video.'
};
export function systemOneBody(text) {
  return {
    model: 'jev-latest',
    state: text,
    questions: {
      intent: { type: 'choice', instructions: 'What is this message from a client of a video production studio mainly about?', criteria: INTENTS },
      edit_type: { type: 'choice', instructions: 'If the message asks for a change to a video, which change? Otherwise "none".', criteria: EDIT_TYPES }
    }
  };
}
// Map Jev's answer to the engine's label shape.
export function toLabel(answers) {
  const intent = answers.intent && answers.intent.choice;
  let reqType = answers.edit_type && answers.edit_type.choice;
  if (reqType === 'none') reqType = null;
  return { intent, reqType, confidence: answers.intent ? answers.intent.confidence : null };
}
