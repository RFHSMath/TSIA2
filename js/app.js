const state = {
  questionId: 'PCT-APP-001',
  attempt: 1,
  progress: 46,
  mastery: 'Developing'
};

const els = {
  prompt: document.querySelector('#questionPrompt'),
  choices: document.querySelector('#answerChoices'),
  feedback: document.querySelector('#feedback'),
  next: document.querySelector('#nextButton'),
  level: document.querySelector('#levelLabel'),
  attempt: document.querySelector('#attemptLabel'),
  progress: document.querySelector('#progressBar'),
  skillPath: document.querySelector('#skillPath'),
  status: document.querySelector('#skillStatus')
};

const data = await fetch('data/questions.json').then(r => r.json());
const questions = new Map(data.questions.map(q => [q.id, q]));

function renderSkillPath() {
  els.skillPath.innerHTML = '';
  data.skillPath.forEach(skill => {
    const span = document.createElement('span');
    span.className = `skill-pill ${skill.status}`;
    span.textContent = skill.name;
    els.skillPath.appendChild(span);
  });
}

function renderQuestion() {
  const q = questions.get(state.questionId);
  els.prompt.textContent = q.prompt;
  els.level.textContent = q.level;
  els.attempt.textContent = `Attempt ${state.attempt}`;
  els.status.textContent = state.mastery;
  els.progress.style.width = `${state.progress}%`;
  els.feedback.hidden = true;
  els.feedback.className = 'feedback';
  els.next.hidden = true;
  els.choices.innerHTML = '';

  q.choices.forEach(choice => {
    const button = document.createElement('button');
    button.className = 'choice';
    button.textContent = choice.text;
    button.addEventListener('click', () => handleChoice(choice.type));
    els.choices.appendChild(button);
  });
}

function lockChoices() {
  [...els.choices.querySelectorAll('button')].forEach(b => b.disabled = true);
}

function showFeedback(text, kind, nextLabel, nextQuestion, progress, mastery) {
  lockChoices();
  els.feedback.textContent = text;
  els.feedback.className = `feedback ${kind}`;
  els.feedback.hidden = false;
  els.next.textContent = nextLabel;
  els.next.hidden = false;
  els.next.onclick = () => {
    state.questionId = nextQuestion;
    state.attempt += 1;
    state.progress = progress;
    state.mastery = mastery;
    renderQuestion();
  };
}

function handleChoice(type) {
  const q = questions.get(state.questionId);

  if (q.id === 'PCT-APP-001') {
    if (type === 'correct') {
      showFeedback('Correct. You interpreted both the increase and the final value. Let’s see whether that understanding transfers to a harder percent situation.', 'good', 'Try an extension', 'PCT-ADV-001', 72, 'Near Mastery');
    } else if (type === 'increase_only') {
      showFeedback('You found a meaningful number: $10 is 25% of $40. Before solving again, let’s identify what that $10 represents.', 'coach', 'Check the idea', 'PCT-DIAG-001', 42, 'Developing');
    } else {
      showFeedback('That answer suggests we should check the relationship between the original amount, the percent change, and the final value before moving on.', 'coach', 'Run a quick check', 'PCT-DIAG-001', 40, 'Developing');
    }
    return;
  }

  if (q.id === 'PCT-DIAG-001') {
    if (type === 'correct') {
      showFeedback('Exactly. The $10 is the increase, not the final price. Now apply that distinction to a fresh problem.', 'good', 'Try again', 'PCT-RETRY-001', 55, 'Developing');
    } else {
      showFeedback('This is the key distinction: percent-of calculations often produce the amount of change. The final value may require one more operation with the original amount.', 'coach', 'Practice the distinction', 'PCT-RETRY-001', 48, 'Emerging');
    }
    return;
  }

  if (q.id === 'PCT-RETRY-001') {
    if (type === 'correct') {
      showFeedback('Nice recovery. You used the diagnostic idea correctly on a new problem. That is stronger evidence than simply being shown the original solution.', 'good', 'Advance', 'PCT-ADV-001', 78, 'Near Mastery');
    } else if (type === 'increase_only') {
      showFeedback('You again found the increase but stopped before finding the new total. That repeated pattern is useful evidence for both you and your teacher.', 'coach', 'Try the extension anyway', 'PCT-ADV-001', 50, 'Developing');
    } else {
      showFeedback('We still need more evidence on percent-change interpretation. In a full version, this would route you to the smallest missing prerequisite instead of repeating random questions.', 'coach', 'See an advanced example', 'PCT-ADV-001', 44, 'Developing');
    }
    return;
  }

  if (q.id === 'PCT-ADV-001') {
    if (type === 'correct') {
      lockChoices();
      els.feedback.textContent = 'Correct. You have moved beyond the basic TSIA2 target into an advanced transfer problem that also overlaps with SAT/ACT reasoning.';
      els.feedback.className = 'feedback good';
      els.feedback.hidden = false;
      state.progress = 95;
      state.mastery = 'Mastered';
      els.progress.style.width = '95%';
      els.status.textContent = state.mastery;
    } else {
      lockChoices();
      els.feedback.textContent = 'This extension is intentionally harder. Missing it does not erase your TSIA2 progress; it tells the system where your current upper boundary may be.';
      els.feedback.className = 'feedback coach';
      els.feedback.hidden = false;
    }
  }
}

renderSkillPath();
renderQuestion();
