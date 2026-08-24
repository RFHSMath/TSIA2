import { createInitialState, evaluateResponse, overallProgress } from './engine.js';

const [skillsData, questionData] = await Promise.all([
  fetch('data/skills.json').then(response => {
    if (!response.ok) throw new Error('Skill data could not be loaded.');
    return response.json();
  }),
  fetch('data/questions.json').then(response => {
    if (!response.ok) throw new Error('Question data could not be loaded.');
    return response.json();
  })
]);

const skills = skillsData.skills;
const skillsById = new Map(skills.map(skill => [skill.id, skill]));
const questionsById = new Map(questionData.questions.map(question => [question.id, question]));
// Question identifiers are intentionally opaque and may be renumbered during a
// release. Keep saved sessions inside their originating bank version so an
// update never resumes a student on a different question by accident.
const storageKey = `tsia2-percent-phase1-state-${questionData.version}`;
const entryIndexKey = 'tsia2-percent-phase1-entry-index';

function nextDiagnosticEntry() {
  const entries = questionData.diagnosticEntryQuestionIds ?? [questionData.startingQuestionId];
  const previous = Number.parseInt(localStorage.getItem(entryIndexKey) ?? '-1', 10);
  const next = Number.isFinite(previous) ? (previous + 1) % entries.length : 0;
  localStorage.setItem(entryIndexKey, String(next));
  return entries[next];
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.currentQuestionId && questionsById.has(saved.currentQuestionId)) return saved;
  } catch {}
  localStorage.setItem(entryIndexKey, '0');
  return createInitialState(questionData.startingQuestionId);
}

let state = loadState();
let pendingEvidence = null;

const els = {
  skillName: document.querySelector('#skillName'),
  skillStatus: document.querySelector('#skillStatus'),
  progress: document.querySelector('#progressBar'),
  progressMessage: document.querySelector('#progressMessage'),
  prompt: document.querySelector('#questionPrompt'),
  choices: document.querySelector('#answerChoices'),
  feedback: document.querySelector('#feedback'),
  next: document.querySelector('#nextButton'),
  level: document.querySelector('#levelLabel'),
  attempt: document.querySelector('#attemptLabel'),
  hint: document.querySelector('#hint'),
  hintButton: document.querySelector('#hintButton'),
  restart: document.querySelector('#restartButton')
};

const levelLabels = {
  foundational: 'Foundation check',
  core: 'Core skill',
  'TSIA2-core': 'TSIA2 practice',
  advanced: 'Advanced challenge',
  'SAT-ACT-extension': 'SAT / ACT extension'
};

const actionCopy = {
  ADVANCE: ['Nice work', 'Your evidence supports moving forward.'],
  RETRY: ['Good step', 'Try a fresh problem to confirm the idea.'],
  DIAGNOSE: ['Let’s check one idea', 'A short question will help identify what happened.'],
  REGRESS: ['Take a smaller step', 'This quick prerequisite check will repair the blocking idea.'],
  REMEDIATE: ['Focus on this detail', 'A small correction now can make the next problem easier.'],
  TRANSFER: ['Ready for a challenge', 'You are moving into a harder application.'],
  REVIEW: ['Let’s gather one more answer', 'Your recent evidence is mixed, so one response will not define your level.'],
  TEACHER_INTERVENTION: ['Ask for a quick check-in', 'A teacher can help make this step clearer before you continue.']
};

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function currentQuestion() {
  return questionsById.get(state.currentQuestionId);
}

function lockChoices() {
  [...els.choices.querySelectorAll('button')].forEach(button => { button.disabled = true; });
}

function renderComplete() {
  els.skillName.textContent = 'Percent reasoning';
  els.skillStatus.textContent = 'Session complete';
  els.progress.style.width = '100%';
  els.progressMessage.textContent = 'You reached the advanced end of this practice path.';
  els.level.textContent = 'Complete';
  els.attempt.textContent = `${state.attempts.length} responses`;
  els.prompt.textContent = 'You finished this practice path.';
  els.choices.innerHTML = '';
  els.hintButton.hidden = true;
  els.feedback.hidden = false;
  els.feedback.className = 'feedback good';
  els.feedback.innerHTML = '<strong>Well done.</strong> Your answers helped the practice adjust, check gaps, and move into harder work.';
  els.next.textContent = 'Practice again';
  els.next.hidden = false;
  els.next.onclick = restart;
}

function renderQuestion() {
  pendingEvidence = null;
  const question = currentQuestion();
  if (!question) return renderComplete();
  const skill = skillsById.get(question.skillId);
  const record = state.mastery[skill.id];

  els.skillName.textContent = skill.studentName;
  els.skillStatus.textContent = record?.status ?? 'Not assessed';
  els.progress.style.width = `${Math.max(6, overallProgress(state, skills))}%`;
  els.progressMessage.textContent = question.role === 'recovery'
    ? 'This fresh problem is a chance to show recovery.'
    : question.role === 'transfer'
      ? 'You are testing whether the idea works in a harder situation.'
      : 'Show what you know. You can move forward quickly.';
  els.level.textContent = levelLabels[question.difficulty] ?? 'Math practice';
  els.attempt.textContent = `Question ${state.attempts.length + 1}`;
  els.prompt.textContent = question.prompt;
  els.choices.innerHTML = '';
  els.feedback.hidden = true;
  els.feedback.className = 'feedback';
  els.next.hidden = true;
  els.hint.hidden = true;
  els.hintButton.hidden = false;
  els.hintButton.disabled = false;

  for (const choice of question.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = choice.text;
    button.addEventListener('click', () => answer(question, choice.id));
    els.choices.appendChild(button);
  }
}

function answer(question, choiceId) {
  pendingEvidence = evaluateResponse({
    question,
    choiceId,
    state,
    skillsById,
    questionsById,
    hintLevel: state.hintLevel ?? 0
  });
  saveState();
  lockChoices();
  els.hintButton.disabled = true;

  const [heading, summary] = actionCopy[pendingEvidence.recommendedNextAction];
  els.feedback.hidden = false;
  els.feedback.className = `feedback ${pendingEvidence.correctness ? 'good' : 'coach'}`;
  els.feedback.innerHTML = `<strong>${heading}</strong>${summary} ${pendingEvidence.explanation}`;
  els.next.textContent = pendingEvidence.recommendedNextQuestion ? 'Continue' : 'Finish';
  els.next.hidden = false;
  els.next.onclick = renderQuestion;
}

function restart() {
  localStorage.removeItem(storageKey);
  state = createInitialState(nextDiagnosticEntry());
  saveState();
  renderQuestion();
}

els.hintButton.addEventListener('click', () => {
  state.hintLevel = Math.min(3, (state.hintLevel ?? 0) + 1);
  const question = currentQuestion();
  els.hint.textContent = question.hint ?? 'Name the original amount, the percent, and exactly what the question asks you to find.';
  els.hint.hidden = false;
  saveState();
});
els.restart.addEventListener('click', restart);

renderQuestion();
