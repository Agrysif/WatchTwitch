/**
 * Скрипт автосбора бонусных сундуков.
 *
 * Исполняется внутри webview с чатом Twitch, к странице фарминга отношения
 * не имеет — поэтому и вынесен из неё. Внедрением занимается ChatManager
 * при каждой загрузке документа чата.
 */
window.BONUS_COLLECTOR_SCRIPT = `
        (function() {
          // Инициализируем счетчик если его нет
          if (typeof window.__chestsCollectedCount === 'undefined') {
            window.__chestsCollectedCount = 0;
            window.__lastChestPoints = 0;
            console.log('✅ Initialized chest counter');
          }
          
          function clickBonusButton() {
            try {
              // Расширенный список селекторов для кнопок сбора бонусов
              const selectors = [
                // Twitch стандартные селекторы
                'button[class*="ScCoreButton"][class*="ScCoreButtonSuccess"]',
                'button[class*="community-points-summary"]',
                'button[aria-label*="Claim"]',
                'button[aria-label*="claim"]',
                'button[aria-label*="Bonus"]',
                'button[aria-label*="bonus"]',
                'button[data-test-selector*="community-points"]',
                // Селекторы по классам
                'button.tw-button--success',
                'button[class*="claimable"]',
                'button[class*="claim"]',
                // Общие селекторы
                '.community-points-summary button',
                '[class*="community-points"] button[class*="success"]'
              ];
              
              let foundAny = false;
              
              for (const selector of selectors) {
                const buttons = document.querySelectorAll(selector);
                
                for (const button of buttons) {
                  // Проверяем что кнопка существует и видима
                  if (!button || !button.offsetParent) continue;
                  
                  const rect = button.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) continue;
                  
                  const computedStyle = window.getComputedStyle(button);
                  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') continue;
                  
                  // Получаем текст кнопки
                  const text = (button.textContent || button.innerText || '').toLowerCase();
                  const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
                  const className = button.className.toLowerCase();
                  
                  // Проверяем признаки кнопки сбора бонуса
                  const isClaimButton = 
                    text.includes('claim') || 
                    text.includes('собрать') ||
                    ariaLabel.includes('claim') || 
                    ariaLabel.includes('bonus') ||
                    ariaLabel.includes('бонус') ||
                    className.includes('success') ||
                    className.includes('claimable');
                  
                  if (isClaimButton) {
                    foundAny = true;
                    console.log('✅ Found claimable bonus!');
                    console.log('  Selector:', selector);
                    console.log('  Text:', text);
                    console.log('  Aria-label:', ariaLabel);
                    console.log('  Class:', button.className);
                    
                    button.click();
                    window.__chestsCollectedCount++;
                    window.__lastChestPoints = 50;
                    console.log('💰 Chest #' + window.__chestsCollectedCount + ' collected!');
                    return true;
                  }
                }
              }
              
              if (!foundAny) {
                // Логируем только раз в 10 проверок чтобы не спамить
                if (!window.__checkCount) window.__checkCount = 0;
                window.__checkCount++;
                
                if (window.__checkCount % 10 === 0) {
                  console.log('🔍 No bonus chest found (check #' + window.__checkCount + ')');
                }
              }
              
            } catch (err) {
              console.error('❌ Error in clickBonusButton:', err);
            }
            return false;
          }
          
          // Проверяем сразу после загрузки
          setTimeout(clickBonusButton, 2000);
          
          // MutationObserver для мгновенной реакции на изменения DOM
          const observer = new MutationObserver((mutations) => {
            // Проверяем только если есть изменения в DOM
            let shouldCheck = false;
            
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Проверяем добавленные узлы
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === 1) { // Element node
                    const text = node.textContent || '';
                    if (text.toLowerCase().includes('claim') || 
                        text.toLowerCase().includes('bonus') ||
                        node.className && node.className.toString().toLowerCase().includes('community-points')) {
                      shouldCheck = true;
                      console.log('🔔 Bonus-related element added to DOM');
                      break;
                    }
                  }
                }
              } else if (mutation.type === 'attributes' && 
                         (mutation.attributeName === 'class' || mutation.attributeName === 'aria-label')) {
                const target = mutation.target;
                if (target.tagName === 'BUTTON') {
                  shouldCheck = true;
                }
              }
              
              if (shouldCheck) break;
            }
            
            if (shouldCheck) {
              clickBonusButton();
            }
          });
          
          // Наблюдаем за областью где появляются бонусы
          setTimeout(() => {
            const chatRoot = document.querySelector('.chat-room, .stream-chat, [class*="chat"]') || document.body;
            observer.observe(chatRoot, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'aria-label']
            });
            console.log('👀 Observer attached to:', chatRoot.className || 'body');
          }, 1000);
          
          // Интервал как запасной вариант (проверяем каждые 15 секунд)
          setInterval(clickBonusButton, 15000);
          
          console.log('✨ Bonus auto-collector initialized (checking every 15s + on DOM changes)');
        })();
    `;
