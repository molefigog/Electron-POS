<?php

declare(strict_types=1);

final class ErpController
{
    private const REPOSITORIES = [
        'products',
        'categories',
        'taxes',
        'customers',
        'stock',
        'transactions',
        'settings',
    ];

    public function __construct(private readonly PDO $db, private readonly array $user) {}

    public function call(string $repository, string $method, array $args): mixed
    {
        if (!in_array($repository, self::REPOSITORIES, true)) {
            throw new InvalidArgumentException('Unknown repository.');
        }

        $allowed = [
            'products' => ['all', 'find', 'findByBarcode', 'create', 'update', 'delete'],
            'categories' => ['all', 'create', 'delete'],
            'taxes' => ['all', 'create', 'delete'],
            'customers' => ['all', 'find', 'create', 'update', 'delete'],
            'stock' => ['history', 'record'],
            'transactions' => ['all', 'find', 'create', 'update', 'delete', 'convertQuoteToInvoice'],
            'settings' => ['all', 'update'],
        ];

        if (!in_array($method, $allowed[$repository], true)) {
            throw new InvalidArgumentException('Repository method is not allowed.');
        }

        return $this->{$repository . ucfirst($method)}(...$args);
    }

    public function sync(array $input): array
    {
        $changes = is_array($input['changes'] ?? null) ? $input['changes'] : [];
        $acceptedIds = [];
        $conflicts = [];

        foreach ($changes as $change) {
            $syncId = (string) ($change['sync_id'] ?? '');
            if ($syncId === '') {
                continue;
            }

            $statement = $this->db->prepare('SELECT sync_id FROM sync_changes WHERE sync_id = :sync_id');
            $statement->execute(['sync_id' => $syncId]);
            if ($statement->fetch()) {
                $acceptedIds[] = $change['id'] ?? $syncId;
                continue;
            }

            $insert = $this->db->prepare('INSERT INTO sync_changes (user_id, sync_id, repository, method, payload) VALUES (:user_id, :sync_id, :repository, :method, :payload)');
            $insert->execute([
                'user_id' => $this->user['id'],
                'sync_id' => $syncId,
                'repository' => (string) ($change['repository'] ?? ''),
                'method' => (string) ($change['method'] ?? ''),
                'payload' => json_encode($change['args'] ?? [], JSON_THROW_ON_ERROR),
            ]);
            $acceptedIds[] = $change['id'] ?? $syncId;
        }

        $cursor = (string) ($input['cursor'] ?? '');
        $download = $this->db->prepare('SELECT sync_id, repository, method, payload, created_at FROM sync_changes WHERE user_id = :user_id AND id > :cursor ORDER BY id ASC LIMIT 1000');
        $download->execute(['user_id' => $this->user['id'], 'cursor' => ctype_digit($cursor) ? $cursor : 0]);
        $downloaded = array_map(static function (array $row): array {
            return [
                'sync_id' => $row['sync_id'],
                'repository' => $row['repository'],
                'method' => $row['method'],
                'args' => json_decode($row['payload'], true) ?: [],
                'created_at' => $row['created_at'],
            ];
        }, $download->fetchAll());

        $latestStatement = $this->db->prepare('SELECT COALESCE(MAX(id), 0) FROM sync_changes WHERE user_id = :user_id');
        $latestStatement->execute(['user_id' => $this->user['id']]);
        $latest = $latestStatement->fetchColumn();
        return ['acceptedIds' => $acceptedIds, 'conflicts' => $conflicts, 'changes' => $downloaded, 'cursor' => (string) $latest];
    }

    private function productsAll(array $filters = []): array
    {
        return $this->list('products', $filters, 'name');
    }
    private function productsFind(int $id): ?array
    {
        return $this->find('products', $id);
    }
    private function productsFindByBarcode(string $barcode): ?array
    {
        return $this->one('SELECT * FROM products WHERE barcode = :barcode AND is_active = 1', ['barcode' => $barcode]);
    }
    private function productsCreate(array $data): array
    {
        return $this->insertProduct($data);
    }
    private function productsUpdate(int $id, array $data): ?array
    {
        return $this->updateProduct($id, $data);
    }
    private function productsDelete(int $id): array
    {
        $this->db->prepare('UPDATE products SET is_active = 0 WHERE id = :id')->execute(['id' => $id]);
        return ['id' => $id];
    }

    private function categoriesAll(): array
    {
        return $this->all('categories', 'name');
    }
    private function categoriesCreate(string $name): array
    {
        $statement = $this->db->prepare('INSERT INTO categories (name) VALUES (:name)');
        $statement->execute(['name' => $name]);
        return $this->find('categories', (int) $this->db->lastInsertId());
    }
    private function categoriesDelete(int $id): array
    {
        $this->deleteById('categories', $id);
        return ['id' => $id];
    }

    private function taxesAll(): array
    {
        return $this->all('taxes', 'name');
    }
    private function taxesCreate(array $data): array
    {
        $statement = $this->db->prepare('INSERT INTO taxes (name, rate, is_default) VALUES (:name, :rate, :is_default)');
        $statement->execute(['name' => $data['name'], 'rate' => $data['rate'] ?? 0, 'is_default' => $data['is_default'] ?? 0]);
        return $this->find('taxes', (int) $this->db->lastInsertId());
    }
    private function taxesDelete(int $id): array
    {
        $this->deleteById('taxes', $id);
        return ['id' => $id];
    }

    private function customersAll(array $filters = []): array
    {
        return $this->list('customers', $filters, 'name');
    }
    private function customersFind(int $id): ?array
    {
        return $this->find('customers', $id);
    }
    private function customersCreate(array $data): ?array
    {
        return $this->insertSimple('customers', ['name', 'email', 'phone', 'address', 'tax_number'], $data);
    }
    private function customersUpdate(int $id, array $data): ?array
    {
        return $this->updateSimple('customers', $id, ['name', 'email', 'phone', 'address', 'tax_number'], $data);
    }
    private function customersDelete(int $id): array
    {
        $this->deleteById('customers', $id);
        return ['id' => $id];
    }

    private function stockHistory(int $productId): array
    {
        return $this->many('SELECT * FROM stock_movements WHERE product_id = :product_id ORDER BY created_at DESC', ['product_id' => $productId]);
    }
    private function stockRecord(array $data): ?array
    {
        $this->db->beginTransaction();
        try {
            $type = $data['type'];
            $quantity = (float) $data['quantity'];
            $delta = $type === 'out' ? -abs($quantity) : ($type === 'in' ? abs($quantity) : $quantity);
            $statement = $this->db->prepare('INSERT INTO stock_movements (product_id, type, quantity, reason, reference_type, reference_id) VALUES (:product_id, :type, :quantity, :reason, :reference_type, :reference_id)');
            $statement->execute(['product_id' => $data['productId'], 'type' => $type, 'quantity' => abs($quantity), 'reason' => $data['reason'] ?? null, 'reference_type' => $data['referenceType'] ?? 'manual', 'reference_id' => $data['referenceId'] ?? null]);
            $this->db->prepare('UPDATE products SET stock_qty = stock_qty + :delta, updated_at = CURRENT_TIMESTAMP WHERE id = :id')->execute(['delta' => $delta, 'id' => $data['productId']]);
            $this->db->commit();
            return $this->productsFind((int) $data['productId']);
        } catch (Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    private function settingsAll(): array
    {
        return $this->db->query('SELECT `key`, value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    private function settingsUpdate(array $values): array
    {
        $statement = $this->db->prepare('INSERT INTO settings (`key`, value) VALUES (:key, :value) ON DUPLICATE KEY UPDATE value = VALUES(value)');
        foreach ($values as $key => $value) $statement->execute(['key' => $key, 'value' => (string) $value]);
        return $this->settingsAll();
    }

    private function transactionsAll(array $filters = []): array
    {
        return $this->list('transactions', $filters, 'created_at', true);
    }
    private function transactionsFind(int $id): ?array
    {
        $transaction = $this->find('transactions', $id);
        if ($transaction) $transaction['items'] = $this->many('SELECT * FROM transaction_items WHERE transaction_id = :id', ['id' => $id]);
        return $transaction;
    }
    private function transactionsCreate(array $data): ?array
    {
        return $this->transactionWrite(null, $data);
    }
    private function transactionsUpdate(int $id, array $data): ?array
    {
        return $this->transactionWrite($id, $data);
    }
    private function transactionsDelete(int $id): array
    {
        $this->deleteById('transactions', $id);
        return ['id' => $id];
    }
    private function transactionsConvertQuoteToInvoice(int $id, array $overrides = []): ?array
    {
        $quote = $this->transactionsFind($id);
        if (!$quote || $quote['type'] !== 'quote' || $quote['status'] === 'converted') throw new InvalidArgumentException('Quotation cannot be converted.');
        $data = ['type' => 'invoice', 'status' => 'invoice', 'customerId' => $quote['customer_id'], 'items' => $quote['items'], 'discountTotal' => $quote['discount_total'], 'notes' => $quote['notes'], 'issuedAt' => $overrides['issuedAt'] ?? $quote['issued_at'], 'manualReference' => $quote['manual_reference']];
        $invoice = $this->transactionWrite(null, $data, $quote);
        $this->db->prepare("UPDATE transactions SET status = 'converted' WHERE id = :id")->execute(['id' => $id]);
        return $invoice;
    }

    private function transactionWrite(?int $id, array $data, ?array $quote = null): ?array
    {
        $items = $data['items'] ?? [];
        $type = $data['type'] ?? 'quote';
        $number = $quote['number'] ?? $this->nextNumber($type);
        $gross = 0;
        $tax = 0;
        foreach ($items as &$item) {
            $price = $item['unit_price'] === null ? null : (float) $item['unit_price'];
            $item['line_total'] = $price === null ? null : round((float) $item['quantity'] * $price * (1 - ((float) ($item['discount_pct'] ?? 0) / 100)), 2);
            if ($item['line_total'] !== null) {
                $gross += $item['line_total'];
                $rate = (float) ($item['tax_rate'] ?? 0);
                $tax += $rate > 0 ? $item['line_total'] - ($item['line_total'] / (1 + $rate / 100)) : 0;
            }
        }
        unset($item);
        $discount = (float) ($data['discountTotal'] ?? 0);
        $status = $data['status'] ?? $type;
        $values = ['number' => $number, 'type' => $type, 'status' => $status, 'customer_id' => $data['customerId'] ?? null, 'subtotal' => round($gross - $tax, 2), 'discount_total' => $discount, 'tax_total' => round($tax, 2), 'grand_total' => round($gross - $discount, 2), 'notes' => $data['notes'] ?? '', 'issued_at' => $data['issuedAt'] ?? null, 'manual_reference' => $data['manualReference'] ?? null];
        $this->db->beginTransaction();
        try {
            if ($id) {
                $values['id'] = $id;
                $this->db->prepare('UPDATE transactions SET type=:type,status=:status,customer_id=:customer_id,subtotal=:subtotal,discount_total=:discount_total,tax_total=:tax_total,grand_total=:grand_total,notes=:notes,issued_at=COALESCE(:issued_at,issued_at),manual_reference=:manual_reference,updated_at=CURRENT_TIMESTAMP WHERE id=:id')->execute($values);
                $this->db->prepare('DELETE FROM transaction_items WHERE transaction_id=:id')->execute(['id' => $id]);
            } else {
                $this->db->prepare('INSERT INTO transactions (number,type,status,customer_id,subtotal,discount_total,tax_total,grand_total,notes,issued_at,manual_reference) VALUES (:number,:type,:status,:customer_id,:subtotal,:discount_total,:tax_total,:grand_total,:notes,:issued_at,:manual_reference)')->execute($values);
                $id = (int) $this->db->lastInsertId();
            }
            $itemStatement = $this->db->prepare('INSERT INTO transaction_items (transaction_id,product_id,name,quantity,unit_price,discount_pct,tax_rate,line_total,box_size,box_count) VALUES (:transaction_id,:product_id,:name,:quantity,:unit_price,:discount_pct,:tax_rate,:line_total,:box_size,:box_count)');
            foreach ($items as $item) $itemStatement->execute(['transaction_id' => $id, 'product_id' => $item['product_id'] ?? null, 'name' => $item['name'], 'quantity' => $item['quantity'], 'unit_price' => $item['unit_price'] ?? null, 'discount_pct' => $item['discount_pct'] ?? null, 'tax_rate' => $item['tax_rate'] ?? null, 'line_total' => $item['line_total'], 'box_size' => $item['box_size'] ?? null, 'box_count' => $item['box_count'] ?? null]);
            $this->db->commit();
            return $this->transactionsFind($id);
        } catch (Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    private function nextNumber(string $type): string
    {
        $prefix = $type === 'quote' ? 'QUO-' : ($type === 'purchase_order' ? 'PO-' : 'INV-');
        return $prefix . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT);
    }
    private function insertProduct(array $data): ?array
    {
        return $this->insertSimple('products', ['name', 'sku', 'barcode', 'cost_price', 'selling_price', 'stock_qty', 'reorder_level', 'category_id', 'tax_id'], $data, ['stock_qty' => 0, 'reorder_level' => 0]);
    }
    private function updateProduct(int $id, array $data): ?array
    {
        return $this->updateSimple('products', $id, ['name', 'sku', 'barcode', 'cost_price', 'selling_price', 'reorder_level', 'category_id', 'tax_id'], $data);
    }
    private function find(string $table, int $id): ?array
    {
        return $this->one("SELECT * FROM {$table} WHERE id = :id", ['id' => $id]);
    }
    private function all(string $table, string $order): array
    {
        return $this->many("SELECT * FROM {$table} ORDER BY {$order}");
    }
    private function list(string $table, array $filters, string $order, bool $descending = false): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['search'])) {
            $searchColumns = $table === 'transactions' ? ['number'] : ['name'];
            $where[] = '(' . implode(' LIKE :search OR ', $searchColumns) . ' LIKE :search)';
            $params['search'] = '%' . $filters['search'] . '%';
        }
        foreach (['type', 'status'] as $field) if (!empty($filters[$field]) && $table === 'transactions') {
            $where[] = "{$field} = :{$field}";
            $params[$field] = $filters[$field];
        }
        if (!empty($filters['categoryId']) && $table === 'products') {
            $where[] = 'category_id = :categoryId';
            $params['categoryId'] = $filters['categoryId'];
        }
        return $this->many('SELECT * FROM ' . $table . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY ' . $order . ($descending ? ' DESC' : ' ASC'), $params);
    }
    private function one(string $sql, array $params = []): ?array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch();
        return $row ?: null;
    }
    private function many(string $sql, array $params = []): array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll();
    }
    private function insertSimple(string $table, array $columns, array $data, array $defaults = []): ?array
    {
        $data = array_merge($defaults, $data);
        $columns = array_values(array_filter($columns, fn($column) => array_key_exists($column, $data)));
        $params = [];
        foreach ($columns as $column) $params[$column] = $data[$column];
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $columns) . ') VALUES (:' . implode(',:', $columns) . ')';
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $this->find($table, (int)$this->db->lastInsertId());
    }
    private function updateSimple(string $table, int $id, array $columns, array $data): ?array
    {
        $columns = array_values(array_filter($columns, fn($column) => array_key_exists($column, $data)));
        if ($columns) {
            $params = ['id' => $id];
            $sets = [];
            foreach ($columns as $column) {
                $sets[] = "{$column}=:{$column}";
                $params[$column] = $data[$column];
            }
            if (in_array('updated_at', $this->columns($table), true)) $sets[] = 'updated_at=CURRENT_TIMESTAMP';
            $this->db->prepare('UPDATE ' . $table . ' SET ' . implode(',', $sets) . ' WHERE id=:id')->execute($params);
        }
        return $this->find($table, $id);
    }
    private function deleteById(string $table, int $id): void
    {
        $this->db->prepare("DELETE FROM {$table} WHERE id=:id")->execute(['id' => $id]);
    }
    private function columns(string $table): array
    {
        return array_column($this->many("DESCRIBE {$table}"), 'Field');
    }
}
