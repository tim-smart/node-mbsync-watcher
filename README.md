# node-mbsync-watcher

Watch a mbsync Maildir for changes to sync, and sync main mailboxes every
minute.


## Installing

Install with npm:

    npm install -g mbsync-watcher


## Usage

On the command line:

    $ mbsync-watcher channel ~/path/to/maildir INBOX,importantlabel,anotherone \
    > "[Google Mail]/All Mail,[Google Mail]/Important"

The third and fourth options are respectively:

- The mailboxes / labels / folders you want to keep as fresh as possible.
Generally best to set this to your inbox and all labels / folders that also end
up in the inbox. These are updated every minute or on change.

- A blacklist of labels / mailboxes to not listen for filesystem changes. These
will get updated every 5 minutes instead.
