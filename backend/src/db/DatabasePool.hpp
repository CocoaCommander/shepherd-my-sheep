#pragma once

#include <pqxx/pqxx>
#include <memory>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <string>
#include <stdexcept>

/**
 * A simple thread-safe connection pool for libpqxx.
 *
 * On construction it opens `poolSize` connections. Callers acquire one with
 * acquire(), use it, and return it with release(). If the pool is empty,
 * acquire() blocks until a connection is returned.
 */
class DatabasePool {
public:
    DatabasePool(const std::string& connStr, int poolSize)
        : m_connStr(connStr)
    {
        for (int i = 0; i < poolSize; ++i) {
            m_pool.push(std::make_shared<pqxx::connection>(connStr));
        }
    }

    std::shared_ptr<pqxx::connection> acquire() {
        std::unique_lock<std::mutex> lock(m_mutex);
        m_cv.wait(lock, [this] { return !m_pool.empty(); });

        auto conn = m_pool.front();
        m_pool.pop();

        // Reconnect if the connection dropped
        if (!conn->is_open()) {
            conn = std::make_shared<pqxx::connection>(m_connStr);
        }

        return conn;
    }

    void release(std::shared_ptr<pqxx::connection> conn) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_pool.push(std::move(conn));
        m_cv.notify_one();
    }

private:
    std::string m_connStr;
    std::queue<std::shared_ptr<pqxx::connection>> m_pool;
    std::mutex m_mutex;
    std::condition_variable m_cv;
};

/**
 * RAII wrapper — acquires a connection on construction,
 * releases it on destruction. Use this instead of manual acquire/release.
 *
 * Usage:
 *   {
 *       PooledConnection conn(pool);
 *       pqxx::work txn(*conn);
 *       auto result = txn.exec("SELECT ...");
 *       txn.commit();
 *   } // connection returned to pool here
 */
class PooledConnection {
public:
    explicit PooledConnection(std::shared_ptr<DatabasePool> pool)
        : m_pool(pool), m_conn(pool->acquire()) {}

    ~PooledConnection() {
        m_pool->release(m_conn);
    }

    // Non-copyable
    PooledConnection(const PooledConnection&) = delete;
    PooledConnection& operator=(const PooledConnection&) = delete;

    pqxx::connection& operator*()  { return *m_conn; }
    pqxx::connection* operator->() { return m_conn.get(); }

private:
    std::shared_ptr<DatabasePool> m_pool;
    std::shared_ptr<pqxx::connection> m_conn;
};
