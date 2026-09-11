<?php

declare(strict_types=1);

require_once __DIR__ . '/controllers/AuthController.php';
require_once __DIR__ . '/controllers/ErpController.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function jsonInput(): array
{
    $body = file_get_contents('php://input') ?: '';
    $data = json_decode($body, true);
    return is_array($data) ? $data : [];
}

function jsonResponse(mixed $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function routePath(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $scriptDirectory = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');

    if ($scriptDirectory !== '' && $scriptDirectory !== '/' && str_starts_with($path, $scriptDirectory)) {
        $path = substr($path, strlen($scriptDirectory));
    }

    $path = '/' . trim($path, '/');
    return $path === '/api' ? '/' : (str_starts_with($path, '/api/') ? substr($path, 4) : $path);
}

function database(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $name = getenv('DB_DATABASE') ?: '';
    $user = getenv('DB_USERNAME') ?: '';
    $password = getenv('DB_PASSWORD') ?: '';

    if ($name === '' || $user === '') {
        jsonResponse(['message' => 'Database environment is not configured.'], 500);
    }

    try {
        $pdo = new PDO(
            "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
            $user,
            $password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (Throwable $error) {
        jsonResponse(['message' => 'Could not connect to the database.'], 500);
    }

    return $pdo;
}

try {
    $controller = new AuthController(database());
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = routePath();
    $input = jsonInput();

    if ($method === 'POST' && $path === '/register') {
        jsonResponse($controller->register($input), 201);
    }

    if ($method === 'POST' && $path === '/login') {
        jsonResponse($controller->login($input));
    }

    if ($method === 'GET' && $path === '/profile') {
        jsonResponse($controller->profile());
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $path === '/profile') {
        jsonResponse($controller->editProfile($input));
    }

    if ($method === 'POST' && preg_match('#^/rpc/([^/]+)/([^/]+)$#', $path, $matches)) {
        $user = $controller->profile();
        $erp = new ErpController(database(), $user);
        jsonResponse($erp->call(urldecode($matches[1]), urldecode($matches[2]), $input['args'] ?? []));
    }

    if ($method === 'POST' && $path === '/sync') {
        $user = $controller->profile();
        $erp = new ErpController(database(), $user);
        jsonResponse($erp->sync($input));
    }

    jsonResponse(['message' => 'Route not found.'], 404);
} catch (InvalidArgumentException $error) {
    jsonResponse(['message' => $error->getMessage()], 422);
} catch (RuntimeException $error) {
    jsonResponse(['message' => $error->getMessage()], 401);
} catch (PDOException $error) {
    if ((int) $error->errorInfo[1] === 1062) {
        jsonResponse(['message' => 'That email address is already registered.'], 409);
    }

    jsonResponse(['message' => 'A database error occurred.'], 500);
} catch (Throwable $error) {
    jsonResponse(['message' => 'An unexpected server error occurred.'], 500);
}
