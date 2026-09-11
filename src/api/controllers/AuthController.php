<?php

declare(strict_types=1);

final class AuthController
{
    public function __construct(private readonly PDO $db) {}

    public function register(array $input): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $confirmation = (string) ($input['password_confirmation'] ?? '');

        if ($name === '' || mb_strlen($name) > 120) {
            throw new InvalidArgumentException('Name is required and must be 120 characters or fewer.');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('A valid email address is required.');
        }
        if (strlen($password) < 8) {
            throw new InvalidArgumentException('Password must be at least 8 characters.');
        }
        if ($confirmation !== '' && !hash_equals($password, $confirmation)) {
            throw new InvalidArgumentException('Password confirmation does not match.');
        }

        $statement = $this->db->prepare(
            'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :password_hash)'
        );
        $statement->execute([
            'name' => $name,
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);

        $user = $this->findUser((int) $this->db->lastInsertId());
        return $this->withToken($user);
    }

    public function login(array $input): array
    {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $user = $this->findUserByEmail($email);

        if (!$user || !password_verify($password, $user['password_hash'])) {
            throw new RuntimeException('Invalid email or password.');
        }

        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $statement = $this->db->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id');
            $statement->execute([
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'id' => $user['id'],
            ]);
        }

        return $this->withToken($user);
    }

    public function profile(): array
    {
        return $this->publicUser($this->authenticatedUser());
    }

    public function editProfile(array $input): array
    {
        $user = $this->authenticatedUser();
        $fields = [];
        $values = ['id' => $user['id']];

        if (array_key_exists('name', $input)) {
            $name = trim((string) $input['name']);
            if ($name === '' || mb_strlen($name) > 120) {
                throw new InvalidArgumentException('Name is required and must be 120 characters or fewer.');
            }
            $fields[] = 'name = :name';
            $values['name'] = $name;
        }

        if (array_key_exists('email', $input)) {
            $email = strtolower(trim((string) $input['email']));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('A valid email address is required.');
            }
            $fields[] = 'email = :email';
            $values['email'] = $email;
        }

        if (array_key_exists('password', $input)) {
            $password = (string) $input['password'];
            if (strlen($password) < 8) {
                throw new InvalidArgumentException('Password must be at least 8 characters.');
            }
            $fields[] = 'password_hash = :password_hash';
            $values['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
        }

        if ($fields) {
            $statement = $this->db->prepare('UPDATE users SET ' . implode(', ', $fields) . ', updated_at = CURRENT_TIMESTAMP WHERE id = :id');
            $statement->execute($values);
        }

        return $this->publicUser($this->findUser((int) $user['id']));
    }

    private function authenticatedUser(): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            throw new RuntimeException('Authentication token is required.');
        }

        $statement = $this->db->prepare(
            'SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = :token_hash AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > CURRENT_TIMESTAMP)'
        );
        $statement->execute(['token_hash' => hash('sha256', trim($matches[1]))]);
        $user = $statement->fetch();

        if (!$user) {
            throw new RuntimeException('Authentication token is invalid or expired.');
        }

        return $user;
    }

    private function withToken(array $user): array
    {
        $plainToken = bin2hex(random_bytes(32));
        $statement = $this->db->prepare(
            'INSERT INTO api_tokens (user_id, token_hash, expires_at) VALUES (:user_id, :token_hash, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY))'
        );
        $statement->execute([
            'user_id' => $user['id'],
            'token_hash' => hash('sha256', $plainToken),
        ]);

        return [
            'token' => $plainToken,
            'user' => $this->publicUser($user),
        ];
    }

    private function findUser(int $id): array
    {
        $statement = $this->db->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $statement->execute(['id' => $id]);
        $user = $statement->fetch();
        if (!$user) {
            throw new RuntimeException('User not found.');
        }
        return $user;
    }

    private function findUserByEmail(string $email): ?array
    {
        $statement = $this->db->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();
        return $user ?: null;
    }

    private function publicUser(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'created_at' => $user['created_at'] ?? null,
            'updated_at' => $user['updated_at'] ?? null,
        ];
    }
}
