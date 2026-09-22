export interface WorkerPoolOptions {
  size?: number;
  maxQueueSize?: number;
  taskTimeout?: number;
  workerScript?: string;
}

export interface WorkerTask<T = any, R = any> {
  id: string;
  type: string;
  data: T;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
  timeout?: Timer;
}

export interface WorkerMessage<T = any> {
  id: string;
  type: 'task' | 'result' | 'error' | 'ready';
  data?: T;
  error?: string;
}

export class BunWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private pendingTasks: Map<string, WorkerTask> = new Map();
  private workerTaskMap: Map<Worker, string> = new Map();
  private options: Required<WorkerPoolOptions>;
  private idCounter = 0;
  private isShutdown = false;

  constructor(workerScript: string, options: Omit<WorkerPoolOptions, 'workerScript'> = {}) {
    let defaultPoolSize = 4;
    try {
      const os = require('os');
      defaultPoolSize = os.cpus()?.length || 4;
    } catch {
      if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
        defaultPoolSize = navigator.hardwareConcurrency;
      }
    }
    
    this.options = {
      size: options.size ?? defaultPoolSize,
      maxQueueSize: options.maxQueueSize ?? 1000,
      taskTimeout: options.taskTimeout ?? 30000,
      workerScript,
    };

    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.options.size; i++) {
      const worker = new Worker(this.options.workerScript);
      this.setupWorker(worker);
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  private setupWorker(worker: Worker): void {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      
      switch (message.type) {
        case 'ready':
          break;
        case 'result':
          this.handleTaskResult(worker, message.id, message.data);
          break;
        case 'error':
          this.handleTaskError(worker, message.id, new Error(message.error || 'Unknown error'));
          break;
      }
    };

    worker.onerror = (error) => {
      console.error('[WorkerPool] Worker error:', error);
      const taskId = this.workerTaskMap.get(worker);
      if (taskId) {
        this.handleTaskError(worker, taskId, new Error('Worker error: ' + error.message));
      }
    };
  }

  private handleTaskResult(worker: Worker, taskId: string, result: any): void {
    const task = this.pendingTasks.get(taskId);
    if (task) {
      if (task.timeout) clearTimeout(task.timeout);
      this.pendingTasks.delete(taskId);
      this.workerTaskMap.delete(worker);
      task.resolve(result);
    }
    
    this.availableWorkers.push(worker);
    this.processQueue();
  }

  private handleTaskError(worker: Worker, taskId: string, error: Error): void {
    const task = this.pendingTasks.get(taskId);
    if (task) {
      if (task.timeout) clearTimeout(task.timeout);
      this.pendingTasks.delete(taskId);
      this.workerTaskMap.delete(worker);
      task.reject(error);
    }
    
    this.availableWorkers.push(worker);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift()!;
      const worker = this.availableWorkers.shift()!;
      this.executeTask(worker, task);
    }
  }

  private executeTask(worker: Worker, task: WorkerTask): void {
    this.pendingTasks.set(task.id, task);
    this.workerTaskMap.set(worker, task.id);

    if (this.options.taskTimeout > 0) {
      task.timeout = setTimeout(() => {
        this.handleTaskError(worker, task.id, new Error('Task timeout'));
      }, this.options.taskTimeout);
    }

    const message: WorkerMessage = {
      id: task.id,
      type: 'task',
      data: { type: task.type, data: task.data },
    };
    
    worker.postMessage(message);
  }

  async exec<T = any, R = any>(type: string, data: T): Promise<R> {
    if (this.isShutdown) {
      throw new Error('Worker pool is shut down');
    }

    if (this.taskQueue.length >= this.options.maxQueueSize) {
      throw new Error('Task queue is full');
    }

    return new Promise((resolve, reject) => {
      const task: WorkerTask<T, R> = {
        id: String(++this.idCounter),
        type,
        data,
        resolve,
        reject,
      };

      if (this.availableWorkers.length > 0) {
        const worker = this.availableWorkers.shift()!;
        this.executeTask(worker, task);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  run<T = any, R = any>(type: string, data: T): Promise<R> {
    return this.exec<T, R>(type, data);
  }

  getStats(): {
    totalWorkers: number;
    availableWorkers: number;
    pendingTasks: number;
    queuedTasks: number;
  } {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      pendingTasks: this.pendingTasks.size,
      queuedTasks: this.taskQueue.length,
    };
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    for (const task of this.taskQueue) {
      if (task.timeout) clearTimeout(task.timeout);
      task.reject(new Error('Worker pool shutdown'));
    }
    this.taskQueue = [];

    for (const task of this.pendingTasks.values()) {
      if (task.timeout) clearTimeout(task.timeout);
      task.reject(new Error('Worker pool shutdown'));
    }
    this.pendingTasks.clear();

    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.availableWorkers = [];
  }

  resize(newSize: number): void {
    if (newSize < 1) {
      throw new Error('Pool size must be at least 1');
    }

    const currentSize = this.workers.length;
    
    if (newSize > currentSize) {
      for (let i = currentSize; i < newSize; i++) {
        const worker = new Worker(this.options.workerScript);
        this.setupWorker(worker);
        this.workers.push(worker);
        this.availableWorkers.push(worker);
      }
    } else if (newSize < currentSize) {
      const toRemove = currentSize - newSize;
      for (let i = 0; i < toRemove; i++) {
        const idx = this.availableWorkers.findIndex(w => 
          !this.workerTaskMap.has(w)
        );
        if (idx >= 0) {
          const worker = this.availableWorkers.splice(idx, 1)[0];
          const workerIdx = this.workers.indexOf(worker);
          if (workerIdx >= 0) {
            this.workers.splice(workerIdx, 1);
          }
          worker.terminate();
        }
      }
    }
  }
}

export function createWorkerScript(handlers: Record<string, (data: any) => any | Promise<any>>): string {
  const handlerCode = Object.entries(handlers)
    .map(([name, fn]) => `  "${name}": ${fn.toString()}`)
    .join(',\n');

  return `
const handlers = {
${handlerCode}
};

self.onmessage = async (event) => {
  const { id, type, data } = event.data;
  
  if (type === 'task') {
    try {
      const handler = handlers[data.type];
      if (!handler) {
        throw new Error('Unknown task type: ' + data.type);
      }
      const result = await handler(data.data);
      self.postMessage({ id, type: 'result', data: result });
    } catch (error) {
      self.postMessage({ id, type: 'error', error: error.message });
    }
  }
};

self.postMessage({ type: 'ready' });
`;
}

export class InlineWorkerPool extends BunWorkerPool {
  constructor(
    handlers: Record<string, (data: any) => any | Promise<any>>,
    options?: Omit<WorkerPoolOptions, 'workerScript'>
  ) {
    const script = createWorkerScript(handlers);
    const blob = new Blob([script], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    super(url, options);
  }
}
