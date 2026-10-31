<?php

declare(strict_types=1);

namespace OpenWA\Tests;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use OpenWA\Client;
use OpenWA\Exceptions\OpenWAException;
use PHPUnit\Framework\TestCase;

final class ClientTest extends TestCase
{
    public function testHealthUsesConfiguredBasePathAndAuthentication(): void
    {
        $history = [];
        $handler = HandlerStack::create(new MockHandler([
            new Response(200, ['Content-Type' => 'application/json'], '{"status":"ok"}'),
        ]));
        $handler->push(Middleware::history($history));
        $client = new Client([
            'baseUrl' => 'https://example.test/gateway',
            'apiKey' => 'fixture-key',
            'httpClient' => new HttpClient(['handler' => $handler]),
        ]);
        self::assertSame(['status' => 'ok'], $client->health->check());
        self::assertSame('https://example.test/gateway/api/health', (string) $history[0]['request']->getUri());
        self::assertSame('fixture-key', $history[0]['request']->getHeaderLine('X-API-Key'));
        self::assertFalse($history[0]['options']['allow_redirects']);
    }

    public function testMissingAuthenticationIsRejected(): void
    {
        $this->expectException(OpenWAException::class);
        new Client(['baseUrl' => 'https://example.test', 'apiKey' => '']);
    }
}
