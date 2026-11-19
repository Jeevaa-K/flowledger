const { withTransaction, pool } = require('../src/db');

describe('db.withTransaction helper', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    };
    jest.spyOn(pool, 'connect').mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('commits transaction when fn succeeds', async () => {
    const result = await withTransaction(async (client) => {
      await client.query('INSERT INTO test VALUES ($1)', [1]);
      return 'success';
    });

    expect(result).toBe('success');
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'INSERT INTO test VALUES ($1)', [1]);
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and releases client when fn throws', async () => {
    const error = new Error('Database write error');

    await expect(
      withTransaction(async (client) => {
        await client.query('INSERT INTO test VALUES ($1)', [1]);
        throw error;
      })
    ).rejects.toThrow('Database write error');

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'INSERT INTO test VALUES ($1)', [1]);
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
