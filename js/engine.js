export const ACTIONS = Object.freeze([
  'ADVANCE',
  'RETRY',
  'DIAGNOSE',
  'REGRESS',
  'REMEDIATE',
  'TRANSFER',
  'REVIEW',
  'TEACHER_INTERVENTION'
]);

const STATUS = ['Not Assessed', 'Emerging', 'Developing', 'Near Mastery', 'Mastered'];

export function createInitialState(startQuestionId) {
  return {
    currentQuestionId: startQuestionId,
    mastery: {},
    attempts: [],
    hintLevel: 0,
    sessionStartedAt: new Date().toISOString()
  };
}

function blankMastery() {
  return {
    score: 0,
    independentCorrect: 0,
    assistedCorrect: 0,
    incorrect: 0,
    transferCorrect: 0,
    distinctCorrectQuestions: [],
    recent: [],
    status: 'Not Assessed'
  };
}

function deriveStatus(record, requirements) {
  const minimumCorrect = requirements?.independentCorrect ?? 2;
  const transferRequired = requirements?.transferRequired ?? true;
  const distinctContexts = record.distinctCorrectQuestions.length;

  if (
    record.independentCorrect >= minimumCorrect &&
    distinctContexts >= 2 &&
    (!transferRequired || record.transferCorrect >= 1) &&
    record.score >= 6
  ) return 'Mastered';
  if (record.score >= 4 && record.independentCorrect >= 2) return 'Near Mastery';
  if (record.score >= 2) return 'Developing';
  if (record.independentCorrect + record.assistedCorrect + record.incorrect > 0) return 'Emerging';
  return 'Not Assessed';
}

function relationshipFor(skill, candidateId) {
  if (!skill || !candidateId) return null;
  if (skill.requiredPrerequisites?.includes(candidateId)) return 'required prerequisite';
  if (skill.supportingSkills?.includes(candidateId)) return 'supporting skill';
  if (skill.regressionTargets?.includes(candidateId)) return 'regression target';
  if (skill.alternativePrerequisiteGroups?.some(group => group.skillIds.includes(candidateId))) {
    return 'alternative prerequisite pathway';
  }
  return null;
}

function updateMastery({ state, skill, question, correct, hintLevel }) {
  const previous = structuredClone(state.mastery[skill.id] ?? blankMastery());
  const next = structuredClone(previous);
  const independent = hintLevel === 0;

  if (correct) {
    if (independent) next.independentCorrect += 1;
    else next.assistedCorrect += 1;
    if (!next.distinctCorrectQuestions.includes(question.id)) {
      next.distinctCorrectQuestions.push(question.id);
    }
    if (question.role === 'transfer') next.transferCorrect += 1;
    next.score = Math.min(10, next.score + (question.role === 'transfer' ? 3 : independent ? 2 : 1));
  } else {
    next.incorrect += 1;
    next.score = Math.max(0, next.score - 1);
  }

  next.recent = [...next.recent, { questionId: question.id, correct, hintLevel }].slice(-4);
  next.status = deriveStatus(next, skill.masteryEvidence);

  // Preserve established mastery after one contradiction; require repeated
  // independent misses before lowering the status.
  if (!correct && previous.status === 'Mastered') {
    const independentMisses = next.recent.filter(item => !item.correct && item.hintLevel === 0).length;
    next.status = independentMisses >= 2 ? 'Near Mastery' : 'Mastered';
  }

  state.mastery[skill.id] = next;
  return {
    skillId: skill.id,
    previousStatus: previous.status,
    newStatus: next.status,
    scoreDelta: next.score - previous.score,
    independentCorrectDelta: next.independentCorrect - previous.independentCorrect,
    transferCorrectDelta: next.transferCorrect - previous.transferCorrect
  };
}

function hasConflictingRecentEvidence(record) {
  const recent = record?.recent ?? [];
  return recent.some(item => item.correct) && recent.some(item => !item.correct);
}

function chooseAction({ question, choice, state, skill, correct }) {
  const configured = correct ? question.correctRoute : choice.route;
  let action = configured?.action ?? (correct ? 'ADVANCE' : 'RETRY');

  const record = state.mastery[skill.id];
  const classifiedEvidence = choice.evidence?.misconceptionId ||
    choice.evidence?.prerequisiteSkillId ||
    ['misconception-hypothesis', 'prerequisite-hypothesis'].includes(choice.evidence?.kind);
  const unresolvedGenericError = !correct && !classifiedEvidence;
  if (unresolvedGenericError && hasConflictingRecentEvidence(record)) action = 'REVIEW';

  if (!ACTIONS.includes(action)) throw new Error(`Unsupported routing action: ${action}`);
  return { action, configured };
}

function explainRoute({ action, correct, choice, skill, targetSkill, relationship, masteryChange }) {
  if (correct) {
    if (action === 'TRANSFER') return 'Independent success supports a move to a harder transfer task.';
    if (action === 'ADVANCE') return `The response adds positive evidence for ${skill.studentName} and supports moving forward.`;
    if (action === 'RETRY') return 'The idea is correct; a fresh problem will confirm that the success transfers.';
  }
  if (choice.feedback) return choice.feedback;
  if (action === 'DIAGNOSE') {
    return `The response suggests ${choice.evidence?.misconceptionLabel ?? 'a specific uncertainty'}, so the next item will test that hypothesis before any regression.`;
  }
  if (action === 'REGRESS') {
    return `The diagnostic produced evidence of a blocking ${relationship ?? 'prerequisite'}${targetSkill ? `: ${targetSkill.studentName}` : ''}.`;
  }
  if (action === 'REMEDIATE') return 'A small targeted intervention is appropriate before a fresh retry.';
  if (action === 'REVIEW') return `Recent evidence for ${skill.studentName} conflicts, so the system will collect another independent response rather than relabel mastery immediately.`;
  if (action === 'TEACHER_INTERVENTION') return 'Repeated unresolved evidence indicates that teacher support may now be the most useful next move.';
  return masteryChange.scoreDelta < 0
    ? 'The response lowers confidence slightly, but it does not erase earlier evidence.'
    : 'The next item will gather additional evidence.';
}

export function evaluateResponse({ question, choiceId, state, skillsById, questionsById, hintLevel = 0 }) {
  const skill = skillsById.get(question.skillId);
  if (!skill) throw new Error(`Question references unknown skill: ${question.skillId}`);
  const choice = question.choices.find(item => item.id === choiceId);
  if (!choice) throw new Error(`Unknown choice ${choiceId} for question ${question.id}`);

  const masteryChange = updateMastery({
    state,
    skill,
    question,
    correct: choice.correct,
    hintLevel
  });
  const { action, configured } = chooseAction({ question, choice, state, skill, correct: choice.correct });
  const nextQuestionId = configured?.nextQuestionId ?? null;
  const nextQuestion = nextQuestionId ? questionsById.get(nextQuestionId) : null;
  if (nextQuestionId && !nextQuestion) throw new Error(`Route references unknown question: ${nextQuestionId}`);

  const targetSkillId = configured?.targetSkillId ?? nextQuestion?.skillId ?? null;
  const targetSkill = targetSkillId ? skillsById.get(targetSkillId) : null;
  const relationship = relationshipFor(skill, choice.evidence?.prerequisiteSkillId ?? targetSkillId);

  const evidence = {
    attemptedSkill: skill.id,
    questionId: question.id,
    correctness: choice.correct,
    misconceptionEvidence: (choice.evidence?.kind === 'misconception-hypothesis' || choice.evidence?.misconceptionId) ? [{
      kind: choice.evidence?.kind ?? 'misconception-hypothesis',
      confidence: choice.evidence.confidence ?? 'medium'
    }] : [],
    prerequisiteEvidence: choice.evidence?.prerequisiteSkillId ? {
      skillId: choice.evidence.prerequisiteSkillId,
      relationship: relationshipFor(skill, choice.evidence.prerequisiteSkillId),
      confidence: choice.evidence.confidence ?? 'medium'
    } : null,
    errorType: choice.evidence?.kind === 'generic-error' ? 'generic-error' : choice.evidence?.errorType ?? null,
    assistance: { hintLevel, independent: hintLevel === 0 },
    masteryEvidenceChange: masteryChange,
    recommendedNextAction: action,
    recommendedNextSkill: targetSkillId,
    recommendedNextQuestion: nextQuestionId,
    explanation: explainRoute({
      action,
      correct: choice.correct,
      choice,
      skill,
      targetSkill,
      relationship,
      masteryChange
    })
  };

  state.attempts.push(evidence);
  state.currentQuestionId = nextQuestionId;
  state.hintLevel = 0;
  return evidence;
}

export function overallProgress(state, skills) {
  const relevant = skills.filter(skill => state.mastery[skill.id]);
  if (!relevant.length) return 0;
  const total = relevant.reduce((sum, skill) => {
    const status = state.mastery[skill.id]?.status ?? 'Not Assessed';
    return sum + Math.max(0, STATUS.indexOf(status));
  }, 0);
  return Math.round((total / (relevant.length * (STATUS.length - 1))) * 100);
}
