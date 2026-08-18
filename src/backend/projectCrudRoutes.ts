import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  CreateTopicProjectSchema,
  UpdateProjectSchema
} from '../shared/topic.ts';
import {
  getProjectId
} from './projectRoutes.ts';

import type {AppContext} from './appContext.ts';
import {sendApiError} from './appErrors.ts';
import {readExpectedRevision, readJsonBody, sendJson, sendProject, validationFields} from './httpTransport.ts';
import type {ApiRouteHandler} from './routeTypes.ts';

type ProjectCrudRouteContext = Pick<AppContext, 'repository'>;

export function createProjectCrudRouteHandler(context: ProjectCrudRouteContext): ApiRouteHandler {
  const {repository} = context;
  return async (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => {
    if (requestUrl.pathname === '/api/projects' && request.method === 'GET') {
      const projectList = await repository.listProjects();
      sendJson(response, 200, projectList);
      return true;
    }

    if (requestUrl.pathname === '/api/projects' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const parsedInput = CreateTopicProjectSchema.safeParse(body);

      if (!parsedInput.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Một vài thông tin cần được kiểm tra lại.',
          fields: validationFields(parsedInput.error.issues),
        });
        return true;
      }

      const project = await repository.createTopicProject(parsedInput.data);
      sendProject(response, 201, project);
      return true;
    }

    const projectId = getProjectId(requestUrl.pathname);

    if (projectId && request.method === 'GET') {
      const project = await repository.getProject(projectId);

      if (!project) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }

      sendProject(response, 200, project);
      return true;
    }

    if (projectId && request.method === 'PUT') {
      const expectedRevision = readExpectedRevision(request);
      const body = await readJsonBody(request);
      const parsedUpdate = UpdateProjectSchema.safeParse(body);

      if (!parsedUpdate.success) {
        sendApiError(response, 422, {
          code: 'VALIDATION_ERROR',
          message: 'Dữ liệu cập nhật chưa hợp lệ.',
          fields: validationFields(parsedUpdate.error.issues),
        });
        return true;
      }

      const project = await repository.updateProject(
        projectId,
        parsedUpdate.data,
        expectedRevision,
      );

      if (!project) {
        sendApiError(response, 404, {
          code: 'PROJECT_NOT_FOUND',
          message: 'Không tìm thấy project.',
        });
        return true;
      }

      sendProject(response, 200, project);
      return true;
    }

    if (projectId && request.method === 'DELETE') {
      const expectedRevision = readExpectedRevision(request);
      await repository.deleteProject(projectId, expectedRevision);

      response.writeHead(204, {'Cache-Control': 'no-store'});
      response.end();
      return true;
    }

    return false;
  };
}

