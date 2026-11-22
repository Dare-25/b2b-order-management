$base = 'http://localhost:3000'
$productId = 3

function Login($email) {
  $body = @{ email = $email; password = 'Password123' } | ConvertTo-Json
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body).token
}

$admin = Login 'test@shop.com'
$c1    = Login 'customer@shop.com'
$c2    = Login 'customer2@shop.com'

for ($run = 1; $run -le 3; $run++) {
  Write-Host "--- Run $run ---"

  # Reset: product has exactly 1 unit, and both carts hold 1 unit of it
  Invoke-RestMethod -Method Patch -Uri "$base/products/$productId/stock" `
    -Headers @{ Authorization = "Bearer $admin" } -ContentType 'application/json' `
    -Body (@{ stock_qty = 1 } | ConvertTo-Json) | Out-Null

  foreach ($t in @($c1, $c2)) {
    try { Invoke-RestMethod -Method Delete -Uri "$base/cart/items/$productId" -Headers @{ Authorization = "Bearer $t" } | Out-Null } catch {}
    Invoke-RestMethod -Method Post -Uri "$base/cart/items" `
      -Headers @{ Authorization = "Bearer $t" } -ContentType 'application/json' `
      -Body (@{ product_id = $productId; quantity = 1 } | ConvertTo-Json) | Out-Null
  }

  # Fire both checkouts at the same time
  $jobs = foreach ($t in @($c1, $c2)) {
    Start-Job -ArgumentList $t, $base -ScriptBlock {
      param($tok, $base)
      try {
        $r = Invoke-RestMethod -Method Post -Uri "$base/orders" -Headers @{ Authorization = "Bearer $tok" }
        "SUCCESS: order $($r.order_id)"
      } catch {
        "REJECTED: " + $_.ErrorDetails.Message
      }
    }
  }
  $jobs | Wait-Job | Receive-Job
  $jobs | Remove-Job

  $stock = ((Invoke-RestMethod -Uri "$base/products" -Headers @{ Authorization = "Bearer $admin" }).products |
            Where-Object { $_.id -eq $productId }).stock_qty
  Write-Host "Final stock: $stock"
}