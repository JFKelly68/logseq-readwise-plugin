import utils from './utils';

const getHighlightsForBook = async (
  latestBookList,
  token,
  width,
  elemBar,
  elemText,
  coolingOffDiv
) => {
  console.log('Getting highlights');

  const userConfigs = await logseq.App.getUserConfigs();
  const preferredDateFormat: string = userConfigs.preferredDateFormat;

  const prepareTags = (t: any[]) => {
    const tagArr = t.map((t) => `[[${t.name}]]`);
    return tagArr.join(', ');
  };

  // Go to each page that has a latest updated date and populate each page
  for (let b of latestBookList) {
    // remove speccial characters
    const bookTitle = b.title.replace(
      /[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi,
      ''
    );

    // Go to page
    logseq.App.pushState('page', { name: `${bookTitle} (Readwise)` });
    console.log(`Updating ${b.title}`);
    const currPage = await logseq.Editor.getCurrentPage();
    console.log(currPage);
    const pageBlockTree = await logseq.Editor.getCurrentPageBlocksTree();

    // Change progress bar
    const interval = 100 / latestBookList.length;
    width = width + interval;
    elemBar.style.width = width + '%';
    elemText.innerHTML = parseFloat(width).toFixed(2) + '%';

    // Implement retry after if trying to get too many sources at one time.
    let highlightsForBook;
    try {
      highlightsForBook = await utils.getHighlightsForBook(b, token);
    } catch (e) {
      console.log(e);
      coolingOffDiv.innerHTML =
        'Please wait for Readwise cooling off to complete.';
      const retryAfter =
        parseInt(e.response.headers['retry-after']) * 1000 + 5000;
      await utils.sleep(retryAfter);
      highlightsForBook = await utils.getHighlightsForBook(b, token);
      coolingOffDiv.innerHTML = '';
    }

    // Filter out only latest highlights
    const latestHighlights = highlightsForBook.data.results.filter(
      (b) => new Date(b.updated) > new Date(logseq.settings['latestRetrieved'])
    );

    if (latestHighlights.length === 0) {
      console.log("No highlights found for '" + b.title + "'");
      continue;
    }

    // Get custom properties
    const customPropertiesStr = logseq.settings['customSyncProperties'].reduce((str, { prop, value }) => {
      return `${ str }
      ${prop}:: ${value}`;
    }, '');

    // Prepare latest highlights for logeq insertion
    let latestHighlightsArr;
    if (b.source === 'kindle') {
      latestHighlightsArr = latestHighlights.map((h) => ({
        content: `${h.text}
                location:: [${h.location}](kindle://book?action=open&asin=${
          b.asin
        }&location=${h.location})
                on:: [[${utils.getDateForPage(
                  new Date(h.highlighted_at),
                  preferredDateFormat
                )}]]
                tags:: ${prepareTags(h.tags)}
                `,
      }));
    } else {
      latestHighlightsArr = latestHighlights.map((h) => ({
        content: `${h.text}
                link:: [${h.url}](${h.url})
                on:: [[${utils.getDateForPage(
                  new Date(h.highlighted_at),
                  preferredDateFormat
                )}]]
                tags:: ${prepareTags(h.tags)}
                `,
      }));
    }

    // Check if page is empty. If empty, create the basic template. If not empty, update only the Readwise Highlights section
    if (pageBlockTree.length === 0) {
      const headerBlock = await logseq.Editor.insertBlock(
        currPage.name,
        'Fetching highlights...',
        {
          isPageBlock: true,
        }
      );

      // Check for if there are no highlights in that partcular book
      if (latestHighlights.length === 0) {
        await logseq.Editor.updateBlock(
          headerBlock.uuid,
          `As of ${utils.blockTitle(
            preferredDateFormat
          )}, there are no new highlights in this book.`
        );
        continue;
      }

      // Insert image
      const imageBlock = await logseq.Editor.insertBlock(
        headerBlock.uuid,
        `![book_image](${b.cover_image_url})`,
        { sibling: true }
      );

      // Insert highlights block
      const highlightsBlock = await logseq.Editor.insertBlock(
        imageBlock.uuid,
        `## [[Readwise Highlights]]`,
        { sibling: true }
      );

      if (logseq.settings.sortRecentFirst) {
        await logseq.Editor.insertBatchBlock(
          highlightsBlock.uuid,
          latestHighlightsArr,
          {
            sibling: false,
          }
        );
      } else {
        await logseq.Editor.insertBatchBlock(
          highlightsBlock.uuid,
          latestHighlightsArr.reverse(),
          {
            sibling: false,
          }
        );
      }

      await logseq.Editor.updateBlock(
        headerBlock.uuid,
        `retrieved:: ${utils.blockTitle(preferredDateFormat)}
          author:: [[${b.author}]]
          category:: [[${b.category}]]
          source:: [[${b.source}]]
          ${ customPropertiesStr }
          tags:: ${prepareTags(b.tags)}
          `
      );
    } else {
      // Insert only new highlights in Readwise Highlights block
      let highlightsBlock = pageBlockTree.filter(
        (b) => b.content == '## [[Readwise Highlights]]'
      );

      // Check for if unable to find Readwise Highlights block
      if (!highlightsBlock[0]) {
        console.log(
          `${b.title} had changes made to its [[Readwise Highlights]] block.`
        );
        const lastBlock = pageBlockTree[pageBlockTree.length - 1];
        highlightsBlock[0] = await logseq.Editor.insertBlock(
          lastBlock.uuid,
          `## [[Readwise Highlights]]`,
          { sibling: true }
        );
      }

      if (!logseq.settings.sortRecentFirst) {
        const getChildren = await logseq.Editor.getBlock(
          highlightsBlock[0].uuid,
          { includeChildren: true }
        );

        const lastBlockOfChildren =
          getChildren.children[getChildren.children.length - 1];

        await logseq.Editor.insertBatchBlock(
          lastBlockOfChildren['uuid'],
          latestHighlightsArr.reverse(),
          {
            sibling: true,
          }
        );
      } else {
        await logseq.Editor.insertBatchBlock(
          highlightsBlock[0].uuid,
          latestHighlightsArr,
          { sibling: false }
        );
      }

      const headerBlock = pageBlockTree[0];

      await logseq.Editor.updateBlock(
        headerBlock['uuid'],
        `retrieved:: ${utils.blockTitle(preferredDateFormat)}
              author:: [[${b.author}]]
              category:: [[${b.category}]]
              source:: [[${b.source}]]
              ${customPropertiesStr}
              `
      );
    }
  }
  logseq.App.showMsg(
    'Highlights imported! If you made any changes to the [[Readwise Highlights]] block before you synced, you may need to revist those pages to remove duplicate higlights. Please refer to the console in Developer Tools for these pages. '
  );

  // Reset progress bar
  width = 0;
  elemBar.style.width = width + '%';
  elemText.innerHTML = parseFloat(width).toFixed(2) + '%';

  if (latestBookList.length > 0) {
    logseq.updateSettings({
      latestRetrieved: latestBookList[0].last_highlight_at,
    });
  }
};

export default { getHighlightsForBook };
