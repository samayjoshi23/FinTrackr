export enum RecordAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export type RecordActionType = RecordAction.CREATE | RecordAction.UPDATE | RecordAction.DELETE;
