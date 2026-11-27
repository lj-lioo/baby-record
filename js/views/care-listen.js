const STOP_TIMEOUT_MS = 2200;
const START_TIMEOUT_MS = 20000;
const NO_TRANSCRIPT_TIMEOUT_MS = 8000;
const LISTEN_TIMEOUT_MS = 20000;

const START_ERRORS = new Map([
  ['NotAllowedError', 'not-allowed'],
  ['SecurityError', 'not-allowed'],
  ['NotSupportedError', 'service-not-allowed'],
  ['NotFoundError', 'audio-capture'],
  ['NotReadableError', 'audio-capture'],
]);

export function careListener(Recognition, { onState, onText, onFinal, onError }) {
  let current;

  function cancel() {
    if (!current) return;
    const turn = current;
    current = null;
    clearTimeout(turn.timeout);
    clearTimeout(turn.settle);
    clearTimeout(turn.ending);
    const speech = turn.speech;
    speech.onaudiostart = speech.onspeechstart = speech.onresult = speech.onerror = speech.onend = null;
    if (!turn.ended) {
      try { speech.abort(); } catch { /* The recognizer may already have stopped. */ }
    }
    onState('idle');
  }

  function finish(turn, error) {
    if (current !== turn) return;
    const text = turn.finalText;
    cancel();
    if (!error && text) onFinal(text);
    else onError(error || 'no-speech');
  }

  function stop() {
    const turn = current;
    if (!turn || turn.ending) return;
    clearTimeout(turn.timeout);
    onState('finishing');
    turn.ending = setTimeout(() => finish(turn), STOP_TIMEOUT_MS);
    try { turn.speech.stop(); } catch { finish(turn, turn.finalText ? '' : 'unavailable'); }
  }

  function start() {
    if (current || !Recognition) return;
    try {
      const speech = new Recognition();
      const turn = { speech, finalText: '' };
      current = turn;
      speech.lang = 'zh-CN';
      speech.interimResults = true;
      speech.continuous = false;
      const markListening = () => {
        if (current !== turn || turn.listening || turn.ending) return;
        turn.listening = true;
        clearTimeout(turn.timeout);
        turn.timeout = setTimeout(() => finish(turn, 'no-transcript'), NO_TRANSCRIPT_TIMEOUT_MS);
        onState('listening');
      };
      speech.onaudiostart = speech.onspeechstart = markListening;
      speech.onresult = (event) => {
        if (current !== turn) return;
        const results = Array.from(event.results);
        const text = results.map((result) => result[0].transcript).join(' ').trim();
        if (text) {
          markListening();
          if (!turn.receivedText && !turn.ending) {
            turn.receivedText = true;
            clearTimeout(turn.timeout);
            turn.timeout = setTimeout(stop, LISTEN_TIMEOUT_MS);
          }
        }
        turn.finalText = results.every((result) => result.isFinal) ? text : '';
        onText(text);
        clearTimeout(turn.settle);
        // Let single-utterance recognition finish naturally. Use the final text if end never arrives.
        if (turn.finalText) turn.settle = setTimeout(() => finish(turn), STOP_TIMEOUT_MS);
      };
      speech.onerror = (event) => finish(turn, event.error || 'unavailable');
      speech.onend = () => {
        turn.ended = true;
        finish(turn);
      };
      onText('');
      onState('starting');
      turn.timeout = setTimeout(() => finish(turn, 'start-timeout'), START_TIMEOUT_MS);
      speech.start();
    } catch (error) {
      cancel();
      onError(START_ERRORS.get(error?.name) || 'unavailable');
    }
  }

  return { start, stop, cancel };
}
