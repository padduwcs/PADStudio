import type {
  OutlineCandidateRecord,
  OutlineHistoryResponse,
  OutlineVersionRecord,
} from '../shared/outlineHistory.ts';
import type {
  TeachingOutlineContent,
  TopicInput,
  TopicProject,
} from '../shared/topic.ts';
import {sameValue} from '../shared/projectPipeline.ts';

function projectOutlineContent(
  project: Pick<TopicProject, 'outline'>,
): TeachingOutlineContent | null {
  if (!project.outline) return null;
  return {
    brief: project.outline.brief,
    centralMessage: project.outline.centralMessage,
    sections: project.outline.sections,
  };
}

export function outlineCandidateMatchesCurrentContext(
  candidate: Pick<OutlineCandidateRecord, 'rootBaseContextHash'> | null,
  history: Pick<OutlineHistoryResponse, 'currentContextHash'> | null,
  project: Pick<TopicProject, 'outline'> | null,
  draft: TeachingOutlineContent | null,
) {
  return Boolean(
    candidate?.rootBaseContextHash &&
      history?.currentContextHash &&
      candidate.rootBaseContextHash === history.currentContextHash &&
      project &&
      draft &&
      sameValue(projectOutlineContent(project), draft),
  );
}

export function outlineVersionMatchesTopicInput(
  version: Pick<OutlineVersionRecord, 'artifact'>,
  topicInput: TopicInput,
) {
  return sameValue(version.artifact.sourceInput, topicInput);
}
