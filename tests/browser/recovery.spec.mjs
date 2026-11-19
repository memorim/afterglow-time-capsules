import {test,expect} from '@playwright/test';
test('mobile layout and recovery after a failed API request',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('.load-feedback')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.route('**/api/capsules*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Test unavailable"}'}));
 await page.reload();await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
 await page.unroute('**/api/capsules*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(page.locator('.load-feedback')).toHaveText('');
});

test('failed form submission retains entered data',async({page})=>{
 await page.goto('/');await page.locator(".create").first().click();const form=page.locator("#create-form");await expect(form).toBeVisible();
 const values={"sender": "Browser Demo", "recipient": "Demo Friend", "title": "Preserved capsule", "message": "Test message stays in form", "passphrase": "DemoPassword2026!"};for(const [name,value] of Object.entries(values))await form.locator('[name="'+name+'"]').fill(value);
 await page.route('**/api/**',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
 await form.locator('button').last().click();await expect(form.getByRole('alert')).toContainText('Не удалось выполнить запрос');
 await expect(form.locator('[name="sender"]')).toHaveValue(values["sender"]);
});

test('browser encrypts the capsule before submitting it', async ({ page }) => {
  await page.goto('/');
  await page.locator('.create').first().click();
  const form = page.locator('#create-form');
  const message = 'Only the encrypted envelope should leave the browser.';
  const passphrase = 'browser-only test password';
  for (const [name, value] of Object.entries({
    sender: 'Browser', recipient: 'Future reader', title: 'Private browser capsule',
    message, passphrase,
  })) await form.locator('[name="' + name + '"]').fill(value);
  const sent = page.waitForResponse(response => response.url().endsWith('/api/capsules') &&
    response.request().method() === 'POST');
  await form.locator('button').last().click();
  const response = await sent;
  expect(response.status()).toBe(201);
  const data = response.request().postDataJSON();
  expect(data.sealed.ciphertext).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----/);
  expect(JSON.stringify(data)).not.toContain(message);
  expect(JSON.stringify(data)).not.toContain(passphrase);
  await expect(page.locator('.create-status')).toContainText('зашифрована');
});
