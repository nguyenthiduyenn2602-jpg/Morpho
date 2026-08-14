/**
 * `cloudflare:workers` 是 Workers 运行时自带的内置模块，不从 node_modules 解析
 * （打包时由 scripts/build-workers.mjs 标成 external，交给运行时提供）。
 *
 * 这里只声明本仓库真正用到的那一小块：一个 Durable Object 基类和 alarm 相关的两个
 * storage 方法。不引 @cloudflare/workers-types 整包是因为那会动 lockfile，而目前
 * 需要的就这么几个成员，自己写清楚反而更看得懂。用到新成员时往这里补。
 */
declare module 'cloudflare:workers' {
  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    /** 当前挂着的 alarm 时间戳；没有则为 null。 */
    getAlarm(): Promise<number | null>;
    /** 设定 alarm；同一个对象同时只能挂一个，重复设会覆盖。 */
    setAlarm(scheduledTime: number | Date): Promise<void>;
  }

  export interface DurableObjectState {
    storage: DurableObjectStorage;
  }

  /** 继承它才能用 RPC（`stub.yourMethod()`）；传统写法只能走 `stub.fetch()`。 */
  export class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected ctx: DurableObjectState;
    protected env: Env;
  }
}
